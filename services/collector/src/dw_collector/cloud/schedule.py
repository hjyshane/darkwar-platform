"""When each routine is next due, kept in SQLite so a restart does not reset it.

A routine that keeps failing is switched off (and stays off across restarts)
rather than retried forever: repeated taps on a screen the code no longer
understands are how automation spends things it should not. A person turns it
back on with `enable`.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

MAX_FAILURES = 3
BACKOFF_SECONDS = 300.0


class Schedule:
    def __init__(self, path: Path | str) -> None:
        self._db = sqlite3.connect(str(path))
        self._db.execute(
            "create table if not exists routine_state("
            "name text primary key, ready_at real not null default 0,"
            " failures integer not null default 0, disabled integer not null default 0,"
            " detail text not null default '')"
        )
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    def _row(self, name: str) -> tuple[float, int, int]:
        row = self._db.execute(
            "select ready_at, failures, disabled from routine_state where name=?", (name,)
        ).fetchone()
        return row if row is not None else (0.0, 0, 0)

    def is_due(self, name: str, now: float) -> bool:
        ready_at, _, disabled = self._row(name)
        return not disabled and now >= ready_at

    def is_disabled(self, name: str) -> bool:
        return bool(self._row(name)[2])

    def failures(self, name: str) -> int:
        return self._row(name)[1]

    def _put(self, name: str, ready_at: float, failures: int, disabled: int, detail: str) -> None:
        self._db.execute(
            "insert into routine_state(name, ready_at, failures, disabled, detail)"
            " values(?,?,?,?,?) on conflict(name) do update set ready_at=excluded.ready_at,"
            " failures=excluded.failures, disabled=excluded.disabled, detail=excluded.detail",
            (name, ready_at, failures, disabled, detail),
        )
        self._db.commit()

    def succeeded(self, name: str, now: float, next_in: float) -> None:
        self._put(name, now + next_in, 0, 0, "")

    def failed(self, name: str, now: float, detail: str) -> bool:
        """Record a failure. True when this one switched the routine off."""
        _, failures, _ = self._row(name)
        failures += 1
        disable = failures >= MAX_FAILURES
        self._put(name, now + BACKOFF_SECONDS * 2 ** (failures - 1), failures, int(disable), detail)
        return disable

    def enable(self, name: str) -> None:
        self._put(name, 0.0, 0, 0, "")

    def snapshot(self) -> dict[str, dict[str, object]]:
        rows = self._db.execute(
            "select name, ready_at, failures, disabled, detail from routine_state order by name"
        ).fetchall()
        return {
            n: {"ready_at": r, "failures": f, "disabled": bool(d), "detail": t}
            for n, r, f, d, t in rows
        }
