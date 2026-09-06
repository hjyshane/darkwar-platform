#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::Manager;

/// The sidecar process, and where it is listening.
///
/// The `Child` is held so it can be killed on exit — and, just as
/// importantly, so its stdin pipe stays open. THAT PIPE IS THE HEARTBEAT:
/// the sidecar exits by itself when its stdin reaches EOF, which is what
/// stops an orphan surviving a panic here. Nothing ever writes to it.
struct Sidecar {
    child: Mutex<Option<Child>>,
    port: u16,
}

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
fn sidecar_path() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("dw-sidecar-x86_64-pc-windows-msvc.exe")
    }
    #[cfg(not(debug_assertions))]
    {
        std::env::current_exe()
            .expect("no path to our own executable")
            .parent()
            .expect("our executable has no directory")
            .join("dw-sidecar.exe")
    }
}

fn start(journal: PathBuf) -> Sidecar {
    let mut command = Command::new(sidecar_path());
    command
        .arg(journal)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().expect("could not start the sidecar");

    // EXACTLY ONE LINE. The sidecar prints nothing before this, by design,
    // so a blocking read of the first line is all it takes to learn the
    // port. `take` leaves the child owning stdin, which is the part that
    // must stay open.
    let stdout = child.stdout.take().expect("sidecar has no stdout");
    let mut line = String::new();
    BufReader::new(stdout)
        .read_line(&mut line)
        .expect("sidecar announced no port");
    let port: u16 = line
        .trim()
        .strip_prefix("PORT ")
        .expect("first line from the sidecar was not a port announcement")
        .parse()
        .expect("the announced port was not a number");

    Sidecar { child: Mutex::new(Some(child)), port }
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

#[tauri::command]
async fn find(
    state: tauri::State<'_, Sidecar>,
    needle: String,
) -> Result<serde_json::Value, String> {
    let url = format!("http://127.0.0.1:{}/find?q={}", state.port, encoded(&needle));
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
    let url = format!("http://127.0.0.1:{}/health", state.port);
    reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
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
    tauri::Builder::default()
        .setup(|app| {
            let journal = app
                .path()
                .app_data_dir()
                .expect("no application data directory")
                .join("collector.db");
            app.manage(start(journal));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![find, health])
        .build(tauri::generate_context!())
        .expect("failed to start the Dark War window")
        .run(|app, event| {
            // The ordinary path. The sidecar's own stdin guard covers what
            // this never reaches — a panic here, or being killed from Task
            // Manager — because Rust holding that pipe open is the only
            // thing telling the sidecar we are still alive.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Ok(mut held) = state.child.lock() {
                        if let Some(mut child) = held.take() {
                            #[cfg(windows)]
                            kill_tree(child.id());
                            #[cfg(not(windows))]
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
