#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::Manager;

/// What the sidecar is doing, as far as the window is concerned.
///
/// SPAWNING IT USED TO HAPPEN IN `setup`, ON THE MAIN THREAD, and that is a
/// worse failure than it looks: the port is read with a blocking `read_line`,
/// so a sidecar that starts and never speaks — the wrong binary, a stalled
/// PyInstaller unpack, antivirus holding the file — meant the event loop was
/// never reached and NO WINDOW EVER PAINTED. Not a frozen window; nothing at
/// all, for people who cannot read a stack trace. The window now opens first
/// and this fills in behind it.
enum Status {
    /// Spawned, and its port announcement has not arrived yet.
    Starting,
    /// Answering on `port`. The `Child` is held so it can be killed on exit
    /// and — just as importantly — so its stdin pipe stays open. THAT PIPE IS
    /// THE HEARTBEAT: the sidecar exits by itself when stdin reaches EOF,
    /// which is what stops an orphan surviving a panic here. Nothing ever
    /// writes to it.
    Ready { child: Child, port: u16 },
    /// It will not answer, and this says why in a sentence a player can act
    /// on rather than a panic nobody will ever see.
    Failed(String),
}

struct Sidecar(Mutex<Status>);

/// Windows: do not give the child a console window of its own.
///
/// The sidecar is built `console=True` because it announces its port on
/// stdout and we have to read it. Without this flag a GUI process spawning
/// a console process pops a black window beside ours on every start.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Where the packaged sidecar lives.
///
/// Bundled, Tauri's `externalBin` copies it next to our own executable. In
/// `tauri dev` nothing is bundled at all, so it is read straight out of the
/// source tree — the two cases genuinely have no path in common.
fn sidecar_path() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("dw-sidecar-x86_64-pc-windows-msvc.exe"))
    }
    #[cfg(not(debug_assertions))]
    {
        let exe = std::env::current_exe()
            .map_err(|why| format!("no path to our own executable: {why}"))?;
        let dir = exe
            .parent()
            .ok_or_else(|| "our executable has no directory".to_string())?;
        Ok(dir.join("dw-sidecar.exe"))
    }
}

fn start(journal: PathBuf) -> Status {
    match connect(journal) {
        Ok((child, port)) => Status::Ready { child, port },
        Err(why) => Status::Failed(why),
    }
}

/// Spawn the sidecar and learn its port, or say why not.
///
/// EVERY FAILURE HERE IS A SENTENCE, not a panic. In a release build
/// `windows_subsystem = "windows"` means there is no console for a panic
/// message to reach, so an `expect` here is a process that vanishes with no
/// explanation — the worst possible outcome on somebody else's machine.
fn connect(journal: PathBuf) -> Result<(Child, u16), String> {
    let exe = sidecar_path()?;
    let mut command = Command::new(&exe);
    command
        .arg(journal)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|why| format!("could not start the reader at {}: {why}", exe.display()))?;

    // EXACTLY ONE LINE. The sidecar prints nothing before this, by design,
    // so a blocking read of the first line is all it takes. `take` leaves
    // the child owning stdin, which is the part that must stay open.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "the reader was started with no stdout to read".to_string())?;
    let mut line = String::new();
    BufReader::new(stdout)
        .read_line(&mut line)
        .map_err(|why| format!("could not read the reader's first line: {why}"))?;

    // An empty line means it exited before announcing anything — the shape a
    // missing dependency takes.
    let port = line
        .trim()
        .strip_prefix("PORT ")
        .ok_or_else(|| format!("the reader said {line:?} instead of announcing a port"))?
        .parse::<u16>()
        .map_err(|why| format!("the reader announced a port that is not a number: {why}"))?;

    Ok((child, port))
}

/// Percent-encode everything that is not unreserved.
///
/// In-game names carry spaces, `&`, `#` and emoji, every one of which would
/// otherwise end or corrupt the query string.
fn encoded(raw: &str) -> String {
    raw.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{:02X}", other),
        })
        .collect()
}

/// Read the current port out of the sidecar's state, or say why there is
/// none. The lock is released before returning — never held across an
/// `await`, which would not compile in an async command anyway.
fn port_of(state: &tauri::State<'_, Sidecar>) -> Result<u16, String> {
    let held = state
        .0
        .lock()
        .map_err(|_| "the reader's state could not be read".to_string())?;
    match &*held {
        Status::Starting => Err("the reader is still starting".to_string()),
        Status::Ready { port, .. } => Ok(*port),
        Status::Failed(why) => Err(why.clone()),
    }
}

#[tauri::command]
async fn find(
    state: tauri::State<'_, Sidecar>,
    needle: String,
) -> Result<serde_json::Value, String> {
    let port = port_of(&state)?;
    let url = format!("http://127.0.0.1:{}/find?q={}", port, encoded(&needle));
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
    if !status.is_success() {
        // A fresh install has no journal and the sidecar says so with a 503.
        // That is a sentence for the user, not an error to swallow.
        let said = body
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("the sidecar refused the search");
        return Err(said.to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn health(state: tauri::State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    let port = port_of(&state)?;
    let url = format!("http://127.0.0.1:{}/health", port);
    reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

/// What the window should say while it waits, or after it stops waiting.
#[tauri::command]
fn status(state: tauri::State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    let held = state
        .0
        .lock()
        .map_err(|_| "the reader's state could not be read".to_string())?;
    Ok(match &*held {
        Status::Starting => serde_json::json!({ "state": "starting" }),
        Status::Ready { .. } => serde_json::json!({ "state": "ready" }),
        Status::Failed(why) => serde_json::json!({ "state": "failed", "message": why }),
    })
}

/// Kill the sidecar by process tree, not by PID alone.
///
/// `dw-sidecar.exe` is a PyInstaller onefile build: the `Child` we hold is
/// its bootloader, which re-execs a second, real Python process to actually
/// serve `/find`. The two are not in a Windows Job Object together, so
/// `Child::kill` only reaches the bootloader and leaves the inner process
/// orphaned and still serving — confirmed empirically (see
/// `docs/runbooks/desktop-sidecar-lifecycle.md`). `taskkill /F /T` walks the
/// process tree recorded at creation time and reaches both.
#[cfg(windows)]
fn kill_tree(pid: u32) {
    let mut command = Command::new("taskkill");
    command.args(["/F", "/T", "/PID", &pid.to_string()]);
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = command.status();
}

fn main() {
    // Something for support to ask for when the window never appears at all.
    // A release build has no console, so without this a panic before the
    // window exists leaves literally no trace on the user's machine.
    std::panic::set_hook(Box::new(|info| {
        let path = std::env::temp_dir().join("dark-war-crash.txt");
        let _ = std::fs::write(&path, format!("{info}\n"));
    }));

    tauri::Builder::default()
        .setup(|app| {
            let journal = app
                .path()
                .app_data_dir()
                .map_err(|why| format!("no application data directory: {why}"))?
                .join("collector.db");
            app.manage(Sidecar(Mutex::new(Status::Starting)));

            // OFF THE MAIN THREAD ON PURPOSE. This is the blocking read that
            // used to stop the window ever existing.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let outcome = start(journal);
                if let Some(state) = handle.try_state::<Sidecar>() {
                    if let Ok(mut held) = state.0.lock() {
                        *held = outcome;
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![find, health, status])
        .build(tauri::generate_context!())
        .expect("failed to start the Dark War window")
        .run(|app, event| {
            // The ordinary path. The sidecar's own stdin guard covers what
            // this never reaches — a panic here, or being killed from Task
            // Manager — because Rust holding that pipe open is the only
            // thing telling the sidecar we are still alive.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Ok(mut held) = state.0.lock() {
                        if let Status::Ready { child, .. } = &mut *held {
                            // A PID is only meaningful while the process behind it
                            // is still alive — Windows recycles them, and does so
                            // eagerly enough that reuse is not some once-a-decade
                            // fluke. If the bootloader had already crashed on its
                            // own before we got here, killing by its old PID could
                            // reach whatever unrelated process the OS had since
                            // handed that number to, tree and all. `try_wait` is
                            // the check: it tells us whether there is still
                            // something of ours behind the PID before we act on
                            // it, and reaps the child in the process, which is why
                            // the `wait` below never blocks on a corpse.
                            match child.try_wait() {
                                Ok(None) => {
                                    #[cfg(windows)]
                                    kill_tree(child.id());
                                    #[cfg(not(windows))]
                                    let _ = child.kill();
                                }
                                Ok(Some(_)) => {}
                                Err(_) => {}
                            }
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
