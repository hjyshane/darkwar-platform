"""Follow the collector's log files without holding them open.

The three processes run as scheduled tasks so collection survives this
window being closed — which is the whole point of a 24-hour collector. So
the console reads their logs rather than owning their pipes.

Reading is by offset and reopens each time: the files are being appended
to by another process, and dumpcap's ring means one can be replaced under
us. A tailer that dies when that happens is a tailer that is not there on
the night it is needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

LOG_DIR = Path(r"C:\DW_data\logs")

# Name -> file. Kept here rather than in the window so the set of things
# worth watching is one edit, not two.
LOG_FILES = {
    "캡처": LOG_DIR / "capture.log",
    "수집": LOG_DIR / "ingest.log",
    "동기화": LOG_DIR / "sync.log",
}

MAX_LINES = 500


@dataclass
class LogTail:
    """Incremental reader for one growing file."""

    path: Path
    offset: int = 0
    lines: list[str] = field(default_factory=list)

    def read_new(self) -> list[str]:
        """Lines appended since the last call. Empty when nothing changed."""
        if not self.path.exists():
            return []
        try:
            size = self.path.stat().st_size
        except OSError:
            return []

        # Truncated or replaced — dumpcap's ring and a task restart both do
        # this. Start over rather than reading from a stale offset, which
        # would show nothing for as long as the file stays smaller.
        if size < self.offset:
            self.offset = 0

        if size == self.offset:
            return []

        try:
            with self.path.open("r", encoding="utf-8", errors="replace") as handle:
                handle.seek(self.offset)
                chunk = handle.read()
                self.offset = handle.tell()
        except OSError:
            return []

        fresh = [line for line in chunk.splitlines() if line.strip()]
        self.lines.extend(fresh)
        if len(self.lines) > MAX_LINES:
            self.lines = self.lines[-MAX_LINES:]
        return fresh


def tails() -> dict[str, LogTail]:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return {name: LogTail(path) for name, path in LOG_FILES.items()}
