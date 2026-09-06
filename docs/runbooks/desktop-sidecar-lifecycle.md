# The desktop sidecar's lifetime

The app is two processes. The window is Rust; the reader is Python. The
failure that matters is the window going away while Python keeps running,
because that process holds the journal open and, once capture is wired in,
would still be capturing with nothing on screen. This repo has already chased
one phantom process — a scheduled task reporting Running with nothing behind
it — and this is the same shape.

Two mechanisms, because one is not enough:

- **Rust kills the child** on `ExitRequested`. Covers the ordinary close.
- **The sidecar stops when its stdin reaches EOF.** Covers everything Rust
  never gets to run for: a panic, or being killed from Task Manager. Rust
  holds the pipe open and never writes to it; the pipe closing IS the signal.

## The onefile complication

`dw-sidecar.exe` is a PyInstaller **onefile** build, and onefile is not one
process. Measured with `pnpm app` running, via
`Get-CimInstance Win32_Process -Filter "Name LIKE 'dw-%'"`:

```
ProcessId  ParentProcessId  Name
92172      440              dw-desktop.exe
58084      92172            dw-sidecar-x86_64-pc-windows-msvc.exe   <- bootloader
59532      58084            dw-sidecar-x86_64-pc-windows-msvc.exe   <- real interpreter
```

The `Child` Rust holds from `Command::spawn` is PID 58084, the bootloader.
PID 59532 — the actual Python process serving `/find` — is the bootloader's
own child, one hop below anything Rust can see.

Three questions had to be answered empirically, not assumed:

1. **Does the inner process inherit the stdin pipe?** Yes, functionally: the
   sidecar already worked before this task (Rust reads the `PORT nnnn`
   announcement off `child.stdout`), and that announcement is written by the
   inner interpreter, not the bootloader. The bootloader is unremarkable C
   code with no HTTP server in it — for the port line to reach Rust at all,
   stdout (and, by the same code path, stdin) must already be passed through
   to the inner process. The exit tests below confirm this holds for stdin
   too: killing the whole tree, or killing only the parent process (case 2),
   reliably takes the inner process down.

2. **Does killing the bootloader alone take the inner process with it?**
   **No.** Tested directly: with the app running, `taskkill /F /PID
   <bootloader>` (no `/T`) terminates the bootloader, and the inner process
   (PID 59532 in the test run) is left running, `tasklist`-visible, still
   holding the journal open. There is no Job Object linking the two — Windows
   does not create one implicitly, and nothing in this codebase or
   PyInstaller's bootloader sets one up.

3. **So does `taskkill /F /T` (by process tree) reach both?** **Yes**,
   confirmed directly: `taskkill /F /T /PID <bootloader>` while the app was
   running took out the bootloader, the inner process, and a third
   short-lived PID that appeared only in that instant — all three, verified
   by an immediate process-list check showing nothing left.

The consequence: **the snippet-literal fix (`child.kill()`) is not enough.**
It only reaches the bootloader, exactly as measured in point 2, and would
leave the real sidecar process orphaned on every ordinary window close. The
implemented fix instead calls `taskkill /F /T /PID <bootloader-pid>` from the
`ExitRequested` handler in `apps/desktop/src-tauri/src/main.rs` — killing by
recorded process tree, one of the three options this task's brief allowed
(the others were an onedir build, or a Windows Job Object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; `taskkill /F /T` was chosen because it
needs no new crate dependency and was directly verified against this exact
process shape).

The stdin-EOF guard (built in Task 5, inside the sidecar itself) does not
have this problem: it doesn't depend on which process Rust's `Child` handle
points at. When Rust's process dies for any reason — normal exit, force-quit,
or a genuine crash — every handle it held closes, including the write end of
the stdin pipe, and whichever process still holds the read end (confirmed to
be the inner interpreter) sees EOF and exits on its own.

## Verifying after any change to either side

Start with `pnpm app` from `apps/desktop/`, confirm a search returns, then end
the app three ways. After each, `tasklist | findstr /i dw-sidecar` must print
nothing — check for every sidecar process, not just the first.

1. Close the window normally.
2. `taskkill /F /PID <dw-desktop pid>` — the parent alone, NOT `/T`.
3. Put `panic!("lifecycle test")` at the top of the `find` command, search,
   then remove it.

Case 2 is the one that regresses silently: it still passes if the stdin guard
is removed *and* you only ever test case 1.

**A caveat found while running case 3 this session:** a bare `panic!` inside
an `async fn` Tauri command does **not** crash the process. Tauri dispatches
async commands on a tokio worker thread, and the panic unwinds only that
task — the log shows `thread 'tokio-rt-worker' panicked at ...`, the command
invocation fails, but `dw-desktop.exe` and the sidecar both keep running and
the window stays fully responsive. There is no `[profile]` override in
`Cargo.toml`, so this is just tokio's normal per-task panic containment, not
a fluke. If you need to actually reproduce "the window dies mid-call" (rather
than "a command handler failed gracefully"), use `std::process::abort()` in
place of `panic!()` — that was verified in this session to genuinely kill
`dw-desktop.exe`, and the sidecar's stdin guard took down both sidecar
processes cleanly within about 2 seconds. A real crash (an aborting panic
hook, an unwrap on the main thread, an actual segfault) will behave the same
way; a panic caught inside an async command handler will not, and doesn't
need to — that path was never an orphan risk to begin with.

## Last run

2026-09-06, against this task's fix (`taskkill /F /T` in the `ExitRequested`
handler):

1. **Normal close** (click the X): sidecar tree gone within about 2 seconds.
   Clean.
2. **Force quit, parent only** (`taskkill /F /PID <dw-desktop>`, no `/T`):
   sidecar tree gone within about 3 seconds — this is the stdin-EOF guard
   doing the work, since Rust's `ExitRequested` handler never runs when the
   process is killed out from under it. Clean.
3. **Crash mid-call**: a bare `panic!()` in `find` did not crash the process
   (see caveat above — this is a Tauri/tokio property, not a bug in this
   fix). Substituting `std::process::abort()` to genuinely kill the process
   mid-call, the sidecar tree was gone within about 2 seconds. Clean.

No survivors in any case, checked both by `tasklist | findstr /i dw-sidecar`
and by enumerating the full `dw-desktop.exe` / `dw-sidecar*.exe` process tree
with `Get-CimInstance Win32_Process`.
