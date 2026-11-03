"""The command catalog: one row per command the game has spoken, with what we
know about it.

Pulls together five things that were each recorded somewhere else and never
read side by side: how often the command arrived (the journal), what shape its
request and response have (`discovery.payload_shape`), whether a parser claims
it and which tables it feeds (`registry`, `normalized_rows`), which screen of a
UI routine is expected to produce it (`Step.expect`), and the verdict the
capture-sweep runbook reached (`command_catalog.json`, checked against that
document by a test).

Read-only. It opens nothing for writing and sends nothing; the sidecar and
`dw-collector command-catalog` both call `build_catalog` on a journal
connection they already hold.
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from importlib import resources
from pathlib import Path
from typing import Any

from dw_collector import registry
from dw_collector.discovery import payload_shape

#: How many of a command's newest requests feed the shape and the pairing.
#: A shape settles after a handful; the bound keeps the pass cheap on a journal
#: with millions of rows.
SAMPLE_REQUESTS = 200
#: A response is only the answer to a request if it follows closely. `_id` is a
#: per-connection counter, so after a reconnect the same number is reused.
PAIR_WINDOW = timedelta(seconds=120)


@dataclass
class CatalogEntry:
    command: str
    responses: int = 0
    last_seen: str | None = None
    requests: int = 0
    paired: int = 0
    parser: bool = False
    tables: list[str] = field(default_factory=list)
    screens: list[str] = field(default_factory=list)
    verdict_status: str | None = None
    verdict: str | None = None
    note: str | None = None
    response_shape: Any = None
    request_shape: Any = None


def load_verdicts() -> dict[str, dict[str, Any]]:
    """The machine-readable verdict table, keyed by command."""
    text = (
        resources.files("dw_collector").joinpath("command_catalog.json").read_text(encoding="utf-8")
    )
    return {entry["command"]: entry for entry in json.loads(text)["commands"]}


def routine_screens(directories: list[Path]) -> dict[str, list[str]]:
    """command → `routine / step` labels whose `expect` names it."""
    from dw_collector.ui_worker.routine import Routine

    screens: dict[str, list[str]] = defaultdict(list)
    for directory in directories:
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.json")):
            try:
                routine = Routine.load(path)
            except (OSError, ValueError):
                continue  # a hand-edited file that does not parse is not the catalog's problem
            for step in routine.steps:
                for command in step.expect:
                    label = f"{routine.name} / {step.name}"
                    if label not in screens[command]:
                        screens[command].append(label)
    return dict(screens)


def merge_shapes(left: Any, right: Any) -> Any:
    """Union of two shapes: keys from both, differing leaf types joined by `|`."""
    if left is None:
        return right
    if right is None:
        return left
    if isinstance(left, dict) and isinstance(right, dict):
        return {
            k: merge_shapes(left.get(k), right.get(k)) for k in sorted(left.keys() | right.keys())
        }
    if isinstance(left, list) and isinstance(right, list):
        if not left:
            return right
        if not right:
            return left
        return [merge_shapes(left[0], right[0])]
    if left == right:
        return left
    parts = sorted(set(str(left).split("|")) | set(str(right).split("|")))
    return "|".join(parts)


def _parse(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp)


def pair_requests(
    requests: list[tuple[datetime, int | None]],
    responses: list[tuple[datetime, int | None]],
) -> int:
    """How many requests have a response with the same `_id` shortly after.

    Each response answers at most one request. Both lists are for ONE command;
    pairing across commands would need the response to echo a different `c`
    than the request, which no capture has shown (see the world-map runbook).
    """
    pool: dict[int, list[datetime]] = defaultdict(list)
    for stamp, request_id in sorted(responses, key=lambda item: item[0]):
        if request_id is not None:
            pool[request_id].append(stamp)
    paired = 0
    for stamp, request_id in sorted(requests, key=lambda item: item[0]):
        if request_id is None:
            continue
        candidates = pool.get(request_id, [])
        for index, answered in enumerate(candidates):
            if answered < stamp:
                continue
            if answered - stamp <= PAIR_WINDOW:
                del candidates[index]
                paired += 1
            break
    return paired


def _has_request_table(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "select 1 from sqlite_master where type = 'table' and name = 'request_observations'"
    ).fetchone()
    return row is not None


def build_catalog(
    conn: sqlite3.Connection, *, routine_dirs: list[Path] | None = None
) -> list[CatalogEntry]:
    """Every command seen in either direction, parsed, expected by a routine,
    or judged in the runbook — most frequent first."""
    verdicts = load_verdicts()
    screens = routine_screens(routine_dirs or [])
    known = registry.known_commands()
    entries: dict[str, CatalogEntry] = {}

    def entry(command: str) -> CatalogEntry:
        if command not in entries:
            entries[command] = CatalogEntry(command=command)
        return entries[command]

    latest_rowid: dict[str, int] = {}
    for command, count, last_seen, rowid in conn.execute(
        "select source_command, count(*), max(captured_at), max(rowid)"
        " from raw_observations group by source_command"
    ):
        item = entry(str(command))
        item.responses = int(count)
        item.last_seen = str(last_seen)
        latest_rowid[str(command)] = int(rowid)

    for command, rowid in latest_rowid.items():
        payload_row = conn.execute(
            "select payload_json, observation_id from raw_observations where rowid = ?",
            (rowid,),
        ).fetchone()
        item = entries[command]
        try:
            item.response_shape = payload_shape(json.loads(payload_row[0]))
        except ValueError:
            item.response_shape = None
        item.tables = sorted(
            str(r[0])
            for r in conn.execute(
                "select distinct target_table from normalized_rows where observation_id = ?",
                (payload_row[1],),
            )
        )

    if _has_request_table(conn):
        for command, count, last_seen in conn.execute(
            "select source_command, count(*), max(captured_at) from request_observations"
            " group by source_command"
        ):
            item = entry(str(command))
            item.requests = int(count)
            item.last_seen = max(filter(None, [item.last_seen, str(last_seen)]))
            sample = conn.execute(
                "select captured_at, request_id, payload_json from request_observations"
                " where source_command = ? order by captured_at desc limit ?",
                (command, SAMPLE_REQUESTS),
            ).fetchall()
            shape: Any = None
            for _, _, payload_json in sample:
                try:
                    shape = merge_shapes(shape, payload_shape(json.loads(payload_json)))
                except ValueError:
                    continue
            item.request_shape = shape
            requests = [(_parse(r[0]), r[1]) for r in sample]
            since = min(stamp for stamp, _ in requests).isoformat()
            responses = [
                (_parse(r[0]), r[1])
                for r in conn.execute(
                    "select captured_at, json_extract(payload_json, '$._id')"
                    " from raw_observations where source_command = ? and captured_at >= ?",
                    (command, since),
                )
            ]
            item.paired = pair_requests(requests, responses)

    for command in known | verdicts.keys() | screens.keys():
        item = entry(command)
        item.parser = command in known
        item.screens = screens.get(command, [])
        verdict = verdicts.get(command)
        if verdict is not None:
            item.verdict_status = verdict["status"]
            item.verdict = verdict["verdict"]
            item.note = verdict.get("note")
            if verdict.get("parser") is False:
                item.parser = False

    return sorted(entries.values(), key=lambda e: (-e.responses, -e.requests, e.command))


def routine_dirs_from_env(environ: dict[str, str] | None = None) -> list[Path]:
    """`DW_ROUTINES_DIR`, one or more directories separated by the platform's
    path separator. Unset means no screens column, not an error."""
    import os

    value = (environ if environ is not None else os.environ).get("DW_ROUTINES_DIR", "")
    return [Path(part) for part in value.split(os.pathsep) if part]


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def catalog_json(entries: list[CatalogEntry]) -> dict[str, Any]:
    """camelCase keys, like every other body the sidecar sends the window."""
    return {"commands": [{_camel(k): v for k, v in asdict(item).items()} for item in entries]}
