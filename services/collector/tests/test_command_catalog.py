"""The command catalog: aggregation, request/response pairing, and the
machine-readable verdict table staying in step with its documents."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Thread
from urllib.request import urlopen

from dw_collector import catalog, registry
from dw_collector.discovery import payload_shape
from dw_collector.storage.journal import Journal
from tests.conftest import REPO_ROOT, load_observation
from tests.test_request_capture import COLLECTOR, NOW

SWEEP = REPO_ROOT / "docs" / "runbooks" / "capture-sweep.md"
STATUS_WORDS = [
    ("재캡처", "recapture"),
    ("거절", "rejected"),
    ("기각", "rejected"),
    ("승격", "promoted"),
    ("유망", "promising"),
    ("참고", "reference"),
    ("보류", "hold"),
]


def _doc_verdicts() -> dict[str, str | None]:
    lines = SWEEP.read_text(encoding="utf-8").splitlines()
    start = next(n for n, line in enumerate(lines) if line.startswith("| 커맨드 | 판정"))
    found: dict[str, str | None] = {}
    for line in lines[start + 2 :]:
        if not line.startswith("|"):
            break
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        verdict = re.match(r"\*\*(.*?)\*\*", cells[1])
        assert verdict, line
        status = next((s for word, s in STATUS_WORDS if word in verdict.group(1)), None)
        first = cells[0].split("→")[0] if "`init` →" in cells[0] else cells[0]
        for token in re.findall(r"`([A-Za-z][A-Za-z0-9_.]*)`", first):
            if "." in token or token == "init":
                found.setdefault(token, status)
    return found


# --- the verdict table against its documents ---------------------------------


def test_every_documented_verdict_is_in_the_json_with_the_same_status() -> None:
    verdicts = catalog.load_verdicts()
    documented = _doc_verdicts()
    assert documented, "the verdict table was not found in capture-sweep.md"
    assert set(documented) == set(verdicts)
    for command, status in documented.items():
        assert verdicts[command]["status"] == status, command


def test_a_promoted_command_has_a_parser_unless_the_table_says_otherwise() -> None:
    known = registry.known_commands()
    import dw_collector.normalize  # noqa: F401  (registers normalizers)

    missing = [
        command
        for command, entry in catalog.load_verdicts().items()
        if entry["status"] == "promoted" and entry.get("parser", True) and command not in known
    ]
    assert missing == []


def test_the_json_is_well_formed() -> None:
    entries = catalog.load_verdicts().values()
    assert all({"command", "status", "verdict"} <= e.keys() for e in entries)
    assert {e["status"] for e in entries} <= {s for _, s in STATUS_WORDS}


# --- pairing -----------------------------------------------------------------


def _t(seconds: int) -> datetime:
    return NOW + timedelta(seconds=seconds)


def test_a_response_with_the_same_id_after_the_request_pairs() -> None:
    assert catalog.pair_requests([(_t(0), 5)], [(_t(1), 5)]) == 1


def test_wrong_id_early_late_or_missing_ids_do_not_pair() -> None:
    assert catalog.pair_requests([(_t(10), 5)], [(_t(11), 6)]) == 0
    assert catalog.pair_requests([(_t(10), 5)], [(_t(9), 5)]) == 0
    assert catalog.pair_requests([(_t(0), 5)], [(_t(500), 5)]) == 0
    assert catalog.pair_requests([(_t(0), None)], [(_t(1), None)]) == 0
    assert catalog.pair_requests([], []) == 0


def test_one_response_answers_one_request_and_a_reused_id_pairs_twice() -> None:
    assert catalog.pair_requests([(_t(0), 5), (_t(1), 5)], [(_t(2), 5)]) == 1
    # a reconnect restarts the counter: same _id, much later, its own answer
    assert catalog.pair_requests([(_t(0), 1), (_t(1000), 1)], [(_t(1), 1), (_t(1001), 1)]) == 2


# --- shapes ------------------------------------------------------------------


def test_merging_shapes_unions_keys_and_joins_differing_types() -> None:
    merged = catalog.merge_shapes(
        payload_shape({"_id": 1, "a": 1, "l": [{"x": 1}]}),
        payload_shape({"_id": 2, "a": "s", "b": None, "l": []}),
    )
    assert merged == {"_id": "integer", "a": "integer|string", "b": "null", "l": [{"x": "integer"}]}


# --- build_catalog -----------------------------------------------------------


def _request(
    journal: Journal, n: int, command: str, payload: dict[str, object], at: datetime
) -> None:
    import uuid

    from dw_collector.request_log import request_observation

    journal.record_request(
        request_observation(
            observation_id=uuid.uuid5(uuid.NAMESPACE_URL, f"t:{n}"),
            collector_id=COLLECTOR,
            command=command,
            payload=payload,
            captured_at=at,
            collected_from_server_id=580,
        )
    )


def test_catalog_joins_counts_parser_tables_verdict_and_screens(
    journal: Journal, tmp_path: Path
) -> None:
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    rows = registry.get("al.rank")(observation)  # type: ignore[misc]
    journal.record(observation, rows)
    _request(journal, 1, "al.rank", {"_id": 7, "uid": "123456"}, observation.captured_at)
    _request(journal, 2, "never.answered", {"_id": 8}, observation.captured_at)

    routines = tmp_path / "routines"
    routines.mkdir()
    (routines / "r.json").write_text(
        json.dumps(
            {
                "name": "daily",
                "steps": [
                    {"name": "open roster", "action": "tap", "x": 1, "y": 2, "expect": ["al.rank"]}
                ],
            }
        ),
        encoding="utf-8",
    )

    entries = {e.command: e for e in catalog.build_catalog(journal.conn, routine_dirs=[routines])}

    roster = entries["al.rank"]
    assert roster.responses == 1
    assert roster.requests == 1
    assert roster.parser is True
    assert "alliance_member_snapshots" in roster.tables
    assert roster.screens == ["daily / open roster"]
    assert roster.request_shape == {"_id": "integer", "uid": "string"}
    assert "list" in roster.response_shape
    assert "123456" not in json.dumps(catalog.catalog_json(list(entries.values())))

    orphan = entries["never.answered"]
    assert (orphan.responses, orphan.requests, orphan.paired, orphan.parser) == (0, 1, 0, False)

    # verdicts and parsers reach commands the journal has never seen
    assert entries["push.mail"].verdict_status == "promising"
    assert entries["kill.rank"].parser is True


def test_a_journal_from_before_requests_existed_still_builds(tmp_path: Path) -> None:
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.executescript(
        "create table raw_observations (observation_id text primary key, collector_id text,"
        " source_command text, captured_at text, collected_from_server_id integer,"
        " payload_json text, created_at text);"
        "create table normalized_rows (observation_id text, target_table text);"
        "insert into raw_observations values ('o','c','x.y','2026-07-28T12:00:00+00:00',580,"
        " '{\"_id\":1}','2026-07-28T12:00:00+00:00');"
    )
    entries = {e.command: e for e in catalog.build_catalog(conn)}
    assert entries["x.y"].responses == 1
    assert entries["x.y"].requests == 0
    conn.close()


def test_a_routine_that_does_not_parse_is_skipped(tmp_path: Path) -> None:
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    assert catalog.routine_screens([tmp_path]) == {}
    assert catalog.routine_screens([tmp_path / "missing"]) == {}


# --- sidecar -----------------------------------------------------------------


def test_the_sidecar_serves_the_catalog_and_503s_without_a_journal(tmp_path: Path) -> None:
    from dw_collector.desktop import sidecar

    path = tmp_path / "collector.db"
    journal = Journal(path)
    journal.init_db()
    _request(journal, 1, "world.get.new", {"_id": 1, "viewLvl": 1}, NOW.astimezone(UTC))
    journal.close()

    httpd = sidecar.serve(path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        body = json.load(urlopen(f"http://127.0.0.1:{httpd.server_address[1]}/catalog"))
    finally:
        httpd.shutdown()
        httpd.server_close()
    world = next(c for c in body["commands"] if c["command"] == "world.get.new")
    assert world["requests"] == 1
    assert world["requestShape"] == {"_id": "integer", "viewLvl": "integer"}

    missing = sidecar.serve(tmp_path / "none.db", port=0)
    Thread(target=missing.serve_forever, daemon=True).start()
    try:
        from urllib.error import HTTPError

        try:
            urlopen(f"http://127.0.0.1:{missing.server_address[1]}/catalog")
            status = 200
        except HTTPError as exc:
            status = exc.code
    finally:
        missing.shutdown()
        missing.server_close()
    assert status == 503
