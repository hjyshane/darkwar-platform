"""dw-console: one window to start collection and see whether it is working.

Tkinter because it ships with Python — an operator tool that needs its own
install is one more thing to be broken at 2am.

The layout follows the order things fail in: the emulator has to be up
before the game, the game before capture means anything, and capture before
the journal grows. Each row shows what IS, not what was asked for.
"""

from __future__ import annotations

import os
import queue
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import scrolledtext, ttk

from dw_collector.console import logs, session, state
from dw_collector.envfile import load_env_file

REFRESH_MS = 3000
LOG_TAIL_BYTES = 8192

GOOD = "#1a7f37"
BAD = "#b3261e"
IDLE = "#6b6b6b"


class Console:
    def __init__(self, root: tk.Tk, env_file: Path | None = None) -> None:
        self.root = root
        self.env_file = env_file
        self.messages: queue.Queue[str] = queue.Queue()
        # English throughout, like the rest of the repo. Mixing scripts here
        # also invited the encoding problems that cost a build and a log tab
        # today — Windows consoles and .ps1 files are unforgiving about it.
        root.title("Dark War Collector")
        root.geometry("760x560")

        self.journal_path = Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db"))
        self.capture_dir = Path(os.environ.get("DW_CAPTURE_DIR", r"C:\DW_data\live"))
        self.session: session.Session | None = None

        self._build_actions(root)
        self.tails = logs.tails()
        self._build_tabs(root)
        self._tick()

    # --- layout ---------------------------------------------------------

    def _build_actions(self, root: tk.Tk) -> None:
        frame = ttk.LabelFrame(root, text="Actions")
        frame.pack(fill="x", padx=10, pady=(10, 6))

        buttons = [
            ("start", "Start BlueStacks", self._start_emulator),
            ("game", "Start Dark War", self._start_game),
            ("collect", "Start collection", self._start_tasks),
            ("stop", "Stop collection", self._stop_tasks),
            ("web", "Open dashboard", self._open_dashboard),
            ("docker", "Start Docker (local stack)", self._start_docker),
            ("sweep", "Sweep mode: …", self._toggle_sweep),
        ]
        self.buttons: dict[str, ttk.Button] = {}
        for index, (key, label, command) in enumerate(buttons):
            button = ttk.Button(frame, text=label, command=command, width=22)
            button.grid(row=index // 3, column=index % 3, padx=5, pady=5)
            self.buttons[key] = button

    def _build_tabs(self, root: tk.Tk) -> None:
        """One window, tabs instead of three console windows.

        The three processes stay as scheduled tasks — owning them here would
        stop collection every time this window is closed, which is the
        opposite of what a 24-hour collector needs. They write to log files
        with their windows hidden, and these tabs follow those files.
        """
        notebook = ttk.Notebook(root)
        notebook.pack(fill="both", expand=True, padx=10, pady=6)

        status_tab = ttk.Frame(notebook)
        notebook.add(status_tab, text="Status")
        self._build_status(status_tab)

        session_tab = ttk.Frame(notebook)
        notebook.add(session_tab, text="Session")
        self._build_session(session_tab)

        self.log_views: dict[str, scrolledtext.ScrolledText] = {}
        for name in self.tails:
            tab = ttk.Frame(notebook)
            notebook.add(tab, text=name)
            view = scrolledtext.ScrolledText(tab, wrap="none", height=20)
            view.pack(fill="both", expand=True)
            self.log_views[name] = view

        message_tab = ttk.Frame(notebook)
        notebook.add(message_tab, text="Activity")
        self.log = scrolledtext.ScrolledText(message_tab, wrap="none", height=20)
        self.log.pack(fill="both", expand=True)

    def _build_session(self, root: tk.Misc) -> None:
        """A stretch of play, and a receipt for it.

        Capture does not start here — it is already running, and a Start that
        implied otherwise would misdescribe the machine. What this marks is a
        boundary, so "I opened six profiles" becomes a number, and Stop spends
        the ~110s pipeline delay on purpose instead of leaving it to be
        wondered about.
        """
        bar = ttk.Frame(root)
        bar.pack(fill="x", padx=10, pady=(8, 4))
        self.session_start = ttk.Button(bar, text="Start session", command=self._session_start)
        self.session_start.grid(row=0, column=0, padx=(0, 6))
        self.session_stop = ttk.Button(bar, text="Stop and sync", command=self._session_stop)
        self.session_stop.grid(row=0, column=1)
        self.session_stop.state(["disabled"])
        self.session_label = tk.Label(bar, text="not recording", anchor="w", fg=IDLE)
        self.session_label.grid(row=0, column=2, padx=10, sticky="w")

        ttk.Label(
            root,
            text=(
                "Collection runs whether or not a session is open. This counts what arrives\n"
                "while it is, and on Stop it flushes the capture ring and waits for the\n"
                "upload so the figures are what reached the dashboard."
            ),
            justify="left",
        ).pack(anchor="w", padx=10, pady=(0, 6))

        self.session_view = scrolledtext.ScrolledText(root, wrap="none", height=16)
        self.session_view.pack(fill="both", expand=True, padx=10, pady=(0, 8))

    def _session_start(self) -> None:
        started = session.start(self.journal_path)
        if started is None:
            self._append(f"error: no journal at {self.journal_path}")
            return
        self.session = started
        self.session_start.state(["disabled"])
        self.session_stop.state(["!disabled"])
        self.session_view.delete("1.0", "end")
        self._append("session started")

    def _session_stop(self) -> None:
        current = self.session
        if current is None:
            return
        self.session_stop.state(["disabled"])
        self.session_label.config(text="finishing…", fg=IDLE)

        def work() -> str:
            report = session.finish(
                current,
                capture_dir=self.capture_dir,
                collector_dir=Path(__file__).resolve().parents[3],
                progress=lambda message: self.messages.put(message),
            )
            lines = [
                f"session of {current.elapsed / 60:.1f} min",
                f"  {report.observations:,} observations in {len(report.commands)} commands",
                f"  {report.files_ingested} capture file(s) read on stop",
                f"  outbox: {report.outbox_pending:,} pending · {report.sent:,} sent",
                "",
            ]
            lines += [f"  {command:34} {n:5}" for command, n in report.commands.items()]
            lines += [""] + [f"  ! {note}" for note in report.notes]
            receipt = "\n".join(lines)
            self.root.after(0, lambda: self._session_done(report.delivered, receipt))
            return "session finished"

        self._spawn(work)

    def _session_done(self, delivered: bool, receipt: str) -> None:
        self.session = None
        self.session_start.state(["!disabled"])
        self.session_label.config(
            text="delivered" if delivered else "queued, not yet in the cloud",
            fg=GOOD if delivered else BAD,
        )
        self.session_view.delete("1.0", "end")
        self.session_view.insert("end", receipt + "\n")

    def _refresh_session(self) -> None:
        """Live counts while a session is open.

        Cheap: one grouped count over rows newer than a rowid. It runs on the
        UI thread with the rest of the tick because a read-only SQLite query
        against a local file is not what would make this window stutter.
        """
        current = self.session
        if current is None:
            return
        rows = session.counts(current)
        total = sum(rows.values())
        self.session_label.config(
            text=f"recording {current.elapsed / 60:.1f} min · {total:,} observations",
            fg=GOOD if total else IDLE,
        )
        self.session_view.delete("1.0", "end")
        if not rows:
            # Not an error. Between ring rotations nothing arrives however
            # long you look, which is the delay the Stop button exists to end.
            self.session_view.insert("end", "nothing has arrived yet (the ring closes every 60s)\n")
            return
        self.session_view.insert(
            "end", "\n".join(f"  {command:34} {n:5}" for command, n in rows.items()) + "\n"
        )

    def _build_status(self, root: tk.Misc) -> None:
        frame = ttk.LabelFrame(root, text="Status")
        frame.pack(fill="x", padx=10, pady=6)
        self.status_labels: dict[str, tk.Label] = {}
        rows = [
            "BlueStacks",
            "Dark War",
            *state.TASKS,
            "Config",
            "Journal",
            "Last observation",
            "Outbox",
            "Capture files",
            "Latency",
        ]
        for index, name in enumerate(rows):
            ttk.Label(frame, text=name, width=18).grid(row=index, column=0, sticky="w", padx=6)
            value = tk.Label(frame, text="…", anchor="w", fg=IDLE)
            value.grid(row=index, column=1, sticky="w")
            self.status_labels[name] = value

    # --- actions --------------------------------------------------------

    def _spawn(self, work: object) -> None:
        """Run on a thread so a slow adb call cannot freeze the window —
        a console that hangs while you are trying to see why something
        hung is worse than none."""

        def run() -> None:
            try:
                self.messages.put(str(work()))  # type: ignore[operator]
            # Broad on purpose: this is the window you open when something
            # is already wrong, so it shows the failure rather than dying.
            except Exception as exc:
                self.messages.put(f"error: {type(exc).__name__}: {exc}")

        threading.Thread(target=run, daemon=True).start()

    def _start_emulator(self) -> None:
        self._spawn(state.start_emulator)

    def _start_game(self) -> None:
        self._spawn(state.start_game)

    def _start_tasks(self) -> None:
        self._spawn(lambda: "start: " + ", ".join(state.TASKS) + f"  {state.start_tasks()}")

    def _stop_tasks(self) -> None:
        self._spawn(lambda: "stop: " + ", ".join(state.TASKS) + f"  {state.stop_tasks()}")

    def _start_docker(self) -> None:
        self._spawn(state.start_docker)

    def _toggle_sweep(self) -> None:
        """Flip the collection timings, via a UAC prompt.

        The mode is read off disk rather than toggled from what the label
        says, so a click that was cancelled at the prompt leaves the next
        press doing the same thing rather than the opposite one.
        """
        wanted = not state.sweep_state().sweeping
        self.buttons["sweep"].state(["disabled"])
        self.buttons["sweep"].config(text="Sweep mode: working…")
        self._append(
            "re-registering the three tasks"
            + (" for a sweep" if wanted else " at the everyday timings")
            + " - collection stops for a few seconds, and Windows will ask to elevate"
        )
        self._spawn(lambda: state.set_sweep(wanted))

    def _open_dashboard(self) -> None:
        self._spawn(state.open_dashboard)

    # --- refresh --------------------------------------------------------

    def _set(self, name: str, text: str, colour: str) -> None:
        label = self.status_labels.get(name)
        if label is not None:
            label.config(text=text, fg=colour)

    def _tick(self) -> None:
        while not self.messages.empty():
            self._append(self.messages.get())
        self._drain_logs()
        self._refresh_session()
        self._spawn_refresh()
        self.root.after(REFRESH_MS, self._tick)

    def _drain_logs(self) -> None:
        """Cheap enough to do on the UI thread: a seek and a short read per
        file, and nothing at all when a file has not grown."""
        for name, tail in self.tails.items():
            fresh = tail.read_new()
            if not fresh:
                continue
            view = self.log_views[name]
            view.insert("end", "\n".join(fresh) + "\n")
            # Trim, or a day of health lines makes the widget the slowest
            # thing in the window.
            if int(view.index("end-1c").split(".")[0]) > logs.MAX_LINES:
                view.delete("1.0", f"end-{logs.MAX_LINES}l")
            view.see("end")

    def _spawn_refresh(self) -> None:
        def work() -> None:
            emulator = state.emulator_running()
            game = state.game_state() if emulator else "stopped"
            tasks = state.all_task_states()
            journal = state.journal_state(self.journal_path)
            files = len(list(self.capture_dir.glob("*.pcapng"))) if self.capture_dir.exists() else 0
            self.root.after(0, lambda: self._apply(emulator, game, tasks, journal, files))

        threading.Thread(target=work, daemon=True).start()

    def _apply(
        self,
        emulator: bool,
        game: str,
        tasks: list[state.TaskState],
        journal: state.JournalState,
        files: int,
    ) -> None:
        self._set("BlueStacks", "running" if emulator else "stopped", GOOD if emulator else BAD)
        # "unreachable" is not "stopped". The window said stopped for as long
        # as a moved adb port lasted, while the game was up and being captured;
        # naming the third state is the fix, showing it is the point.
        self._set(
            "Dark War",
            {"running": "running", "stopped": "stopped"}.get(game, "cannot reach the emulator"),
            GOOD if game == "running" else BAD,
        )
        for task in tasks:
            self._set(task.name, task.status, GOOD if task.healthy else BAD)

        # A button that does nothing is worse than a missing one: pressing
        # "start" on a running collector looks like it did something, and the
        # only way to find out otherwise is to read the status you already
        # had. Disable by what IS running, checked every refresh.
        running = sum(1 for task in tasks if task.healthy)
        self.buttons["collect"].state(["disabled"] if running == len(tasks) else ["!disabled"])
        self.buttons["stop"].state(["disabled"] if running == 0 else ["!disabled"])
        self.buttons["start"].state(["disabled"] if emulator else ["!disabled"])
        # Offer Start only when the game is genuinely stopped. Pressing it
        # against an endpoint that cannot be reached just fails.
        self.buttons["game"].state(
            ["!disabled"] if emulator and game == "stopped" else ["disabled"]
        )

        # Which .env was read, if any. Without it DW_SQLITE_PATH is unset and
        # the journal falls back to ./data/collector.db, so the window reports
        # "missing" while collection is running perfectly against a different
        # file. Naming the config file makes that five seconds of diagnosis
        # instead of an hour - it already cost one.
        if self.env_file is None:
            self._set("Config", "no .env found - paths are defaults", BAD)
        else:
            self._set("Config", str(self.env_file), GOOD)

        if not journal.exists:
            self._set("Journal", f"missing ({journal.path})", IDLE)
        else:
            self._set(
                "Journal",
                f"{journal.observations:,} observations · {journal.commands} commands",
                GOOD,
            )
        age = journal.seconds_since_last
        if age is None:
            self._set("Last observation", "none yet", IDLE)
        else:
            # Five minutes is the ingest lag plus slack; below that, quiet
            # means the game is quiet rather than the collector being dead.
            self._set("Last observation", f"{age:,.0f}s ago", GOOD if age < 400 else BAD)
        self._set(
            "Outbox",
            f"{journal.pending_outbox:,} pending · {journal.sent_outbox:,} sent",
            BAD if journal.pending_outbox > 5000 else GOOD,
        )
        self._set("Capture files", str(files), GOOD if files else IDLE)

        # WORST CASE, not typical: this is the number somebody uses to decide
        # whether the dashboard has caught up with what they just did, and a
        # typical figure would have them refreshing too early.
        sweep = state.sweep_state()
        if not sweep.known:
            self._set("Latency", "unknown - no registered tasks found", IDLE)
            self.buttons["sweep"].config(text="Sweep mode: ?")
        else:
            self._set(
                "Latency",
                f"~{sweep.worst_case}s worst case ({'sweep' if sweep.sweeping else 'everyday'})",
                GOOD,
            )
            self.buttons["sweep"].config(text="Sweep mode: " + ("on" if sweep.sweeping else "off"))
        self.buttons["sweep"].state(["!disabled"])

    def _append(self, text: str) -> None:
        self.log.insert("end", text.rstrip() + "\n")
        self.log.see("end")


def _load_env() -> Path | None:
    """The working directory first, then next to the executable.

    A shortcut can set a working directory but not an environment, and the
    frozen exe can be launched from anywhere, so cwd alone is not a reliable
    anchor. Falling back to the binary's own location finds `.env` for a
    normal install; when neither works the window says so rather than
    quietly using defaults.
    """
    found = load_env_file()
    if found is not None:
        return found
    base = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
    return load_env_file(start=base)


def main() -> None:
    env_file = _load_env()
    root = tk.Tk()
    Console(root, env_file=env_file)
    root.mainloop()


if __name__ == "__main__":
    main()
