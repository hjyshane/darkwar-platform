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
import threading
import tkinter as tk
from pathlib import Path
from tkinter import scrolledtext, ttk

from dw_collector.console import logs, state
from dw_collector.envfile import load_env_file

REFRESH_MS = 3000
LOG_TAIL_BYTES = 8192

GOOD = "#1a7f37"
BAD = "#b3261e"
IDLE = "#6b6b6b"


class Console:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.messages: queue.Queue[str] = queue.Queue()
        root.title("Dark War 수집기")
        root.geometry("760x560")

        self.journal_path = Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db"))
        self.capture_dir = Path(os.environ.get("DW_CAPTURE_DIR", r"C:\DW_data\live"))

        self._build_actions(root)
        self.tails = logs.tails()
        self._build_tabs(root)
        self._tick()

    # --- layout ---------------------------------------------------------

    def _build_actions(self, root: tk.Tk) -> None:
        frame = ttk.LabelFrame(root, text="시작")
        frame.pack(fill="x", padx=10, pady=(10, 6))

        buttons = [
            ("start", "BlueStacks (collector)", self._start_emulator),
            ("game", "Dark War 실행", self._start_game),
            ("collect", "수집 시작", self._start_tasks),
            ("stop", "수집 중지", self._stop_tasks),
            ("web", "대시보드 열기", self._open_dashboard),
            ("docker", "Docker (로컬 스택용)", self._start_docker),
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
        notebook.add(status_tab, text="상태")
        self._build_status(status_tab)

        self.log_views: dict[str, scrolledtext.ScrolledText] = {}
        for name in self.tails:
            tab = ttk.Frame(notebook)
            notebook.add(tab, text=name)
            view = scrolledtext.ScrolledText(tab, wrap="none", height=20)
            view.pack(fill="both", expand=True)
            self.log_views[name] = view

        message_tab = ttk.Frame(notebook)
        notebook.add(message_tab, text="동작")
        self.log = scrolledtext.ScrolledText(message_tab, wrap="none", height=20)
        self.log.pack(fill="both", expand=True)

    def _build_status(self, root: tk.Misc) -> None:
        frame = ttk.LabelFrame(root, text="상태")
        frame.pack(fill="x", padx=10, pady=6)
        self.status_labels: dict[str, tk.Label] = {}
        rows = [
            "BlueStacks",
            "Dark War",
            *state.TASKS,
            "저널",
            "마지막 관측",
            "outbox",
            "캡처 파일",
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
                self.messages.put(f"오류: {type(exc).__name__}: {exc}")

        threading.Thread(target=run, daemon=True).start()

    def _start_emulator(self) -> None:
        self._spawn(state.start_emulator)

    def _start_game(self) -> None:
        self._spawn(state.start_game)

    def _start_tasks(self) -> None:
        self._spawn(lambda: "수집 시작: " + ", ".join(state.TASKS) + f"  {state.start_tasks()}")

    def _stop_tasks(self) -> None:
        self._spawn(lambda: "수집 중지: " + ", ".join(state.TASKS) + f"  {state.stop_tasks()}")

    def _start_docker(self) -> None:
        self._spawn(state.start_docker)

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
            game = state.game_running() if emulator else False
            tasks = state.all_task_states()
            journal = state.journal_state(self.journal_path)
            files = len(list(self.capture_dir.glob("*.pcapng"))) if self.capture_dir.exists() else 0
            self.root.after(0, lambda: self._apply(emulator, game, tasks, journal, files))

        threading.Thread(target=work, daemon=True).start()

    def _apply(
        self,
        emulator: bool,
        game: bool,
        tasks: list[state.TaskState],
        journal: state.JournalState,
        files: int,
    ) -> None:
        self._set("BlueStacks", "실행 중" if emulator else "꺼짐", GOOD if emulator else BAD)
        self._set("Dark War", "실행 중" if game else "꺼짐", GOOD if game else BAD)
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
        self.buttons["game"].state(["disabled"] if game or not emulator else ["!disabled"])

        if not journal.exists:
            self._set("저널", f"없음 ({journal.path})", IDLE)
        else:
            self._set("저널", f"관측 {journal.observations:,}건 · {journal.commands}종", GOOD)
        age = journal.seconds_since_last
        if age is None:
            self._set("마지막 관측", "없음", IDLE)
        else:
            # Five minutes is the ingest lag plus slack; below that, quiet
            # means the game is quiet rather than the collector being dead.
            self._set(
                "마지막 관측",
                f"{age:,.0f}초 전",
                GOOD if age < 400 else BAD,
            )
        self._set(
            "outbox",
            f"대기 {journal.pending_outbox:,} · 전송 {journal.sent_outbox:,}",
            BAD if journal.pending_outbox > 5000 else GOOD,
        )
        self._set("캡처 파일", f"{files}개", GOOD if files else IDLE)

    def _append(self, text: str) -> None:
        self.log.insert("end", text.rstrip() + "\n")
        self.log.see("end")


def main() -> None:
    load_env_file()
    root = tk.Tk()
    Console(root)
    root.mainloop()


if __name__ == "__main__":
    main()
