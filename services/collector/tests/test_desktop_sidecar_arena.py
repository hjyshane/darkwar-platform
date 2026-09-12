"""`GET /arena` — the sidecar's HTTP surface over the arena projection.

Mirrors `test_desktop_sidecar.py`'s own roster endpoint tests: same journal-
state check, same fresh-connection-per-request, same wire-shape assertions,
proven end to end through actual HTTP rather than only the projection's own
unit tests (see `test_desktop_localread_arena.py`).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from threading import Thread

import pytest

from dw_collector.desktop import sidecar
from dw_collector.storage.journal import Journal


@pytest.fixture
def base(tmp_path: Path) -> Iterator[str]:
    """A started sidecar on a port the OS picks, over an empty journal —
    identical to `test_desktop_sidecar.py`'s own `base` fixture."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


def _write_raw_observation(journal: Journal, *, observation_id: str, captured_at: str) -> None:
    journal.conn.execute(
        "insert or ignore into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values (?, ?, ?, ?, ?, ?, ?)",
        (
            observation_id,
            "00000000-0000-4000-8000-00000000c777",
            "user.get.arena.info",
            captured_at,
            580,
            "{}",
            captured_at,
        ),
    )


def _write_header(
    journal_path: Path,
    *,
    observation_id: str,
    captured_at: str,
    snapshot_id: str,
    league: int | None,
    week_start: str = "2026-09-07T02:00:00+00:00",
    entry_count: int | None = 1,
) -> None:
    journal = Journal(journal_path)
    _write_raw_observation(journal, observation_id=observation_id, captured_at=captured_at)
    row = {
        "row": {
            "snapshot_id": snapshot_id,
            "server_id": 580,
            "week_start": week_start,
            "entry_count": entry_count,
            "league": league,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (observation_id, "arena_snapshots", f"header-{snapshot_id}", json.dumps(row), captured_at),
    )
    journal.conn.commit()
    journal.close()


def _write_entry(
    journal_path: Path,
    *,
    observation_id: str,
    captured_at: str,
    entry_id: str,
    arena_snapshot_id: str,
    game_uid: int,
    rank: int,
    name: str | None = "ERHA",
) -> None:
    journal = Journal(journal_path)
    _write_raw_observation(journal, observation_id=observation_id, captured_at=captured_at)
    row = {
        "row": {
            "snapshot_id": entry_id,
            "arena_snapshot_id": arena_snapshot_id,
            "server_id": 581,
            "game_uid": game_uid,
            "name": name,
            "rank": rank,
            "score": 5000,
            "defense_power": 1_000_000,
            "alliance_name": "Erha's Legion",
            "alliance_code": "ERHA",
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (observation_id, "arena_entries", f"entry-{entry_id}", json.dumps(row), captured_at),
    )
    journal.conn.commit()
    journal.close()


def _write_hero(
    journal_path: Path,
    *,
    observation_id: str,
    captured_at: str,
    arena_entry_id: str,
    hero_id: int,
) -> None:
    journal = Journal(journal_path)
    _write_raw_observation(journal, observation_id=observation_id, captured_at=captured_at)
    row = {
        "row": {
            "arena_entry_id": arena_entry_id,
            "slot": 1,
            "hero_id": hero_id,
            "troop_class": 2,
            "hero_level": 60,
            "level_synced": False,
            "star": 5,
            "stage": 2,
            "hero_power": 200_000,
            "weapon_level": 20,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            "arena_entry_heroes",
            f"hero-{arena_entry_id}-{hero_id}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()
    journal.close()


def test_arena_returns_no_boards_for_an_empty_journal(base: str) -> None:
    with urllib.request.urlopen(f"{base}/arena") as response:
        body = json.loads(response.read())
    assert body == {"boards": []}


def test_arena_on_a_missing_journal_answers_rather_than_dropping(tmp_path: Path) -> None:
    missing = tmp_path / "not-here.db"
    httpd = sidecar.serve(missing, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/arena"
        with pytest.raises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(url)
        code = raised.value.code
        body = json.loads(raised.value.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert code == 503
    assert body["state"] == sidecar.NO_JOURNAL
    assert not missing.exists()


def test_arena_endpoint_shows_both_leagues_with_week_start_and_captured_at(
    tmp_path: Path,
) -> None:
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    _write_header(
        journal_path,
        observation_id="obs-gold",
        captured_at="2026-09-07T03:00:00+00:00",
        snapshot_id="gold-snap",
        league=1,
        week_start="2026-09-07T02:00:00+00:00",
    )
    _write_header(
        journal_path,
        observation_id="obs-silver",
        captured_at="2026-09-07T04:00:00+00:00",
        snapshot_id="silver-snap",
        league=2,
        week_start="2026-09-07T02:00:00+00:00",
    )
    _write_entry(
        journal_path,
        observation_id="obs-gold",
        captured_at="2026-09-07T03:00:00+00:00",
        entry_id="entry-gold-1",
        arena_snapshot_id="gold-snap",
        game_uid=1190060554000581,
        rank=1,
        name="GOLD_PLAYER",
    )
    _write_entry(
        journal_path,
        observation_id="obs-gold",
        captured_at="2026-09-07T03:00:00+00:00",
        entry_id="entry-gold-no-heroes",
        arena_snapshot_id="gold-snap",
        game_uid=2,
        rank=2,
        name="NO_LINEUP",
    )
    _write_hero(
        journal_path,
        observation_id="obs-gold",
        captured_at="2026-09-07T03:00:00+00:00",
        arena_entry_id="entry-gold-1",
        hero_id=1001,
    )

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/arena"
        with urllib.request.urlopen(url) as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert len(body["boards"]) == 2
    by_league = {board["league"]: board for board in body["boards"]}
    assert by_league[1]["weekStart"] == "2026-09-07T02:00:00+00:00"
    assert by_league[1]["capturedAt"] == "2026-09-07T03:00:00+00:00"
    assert by_league[2]["capturedAt"] == "2026-09-07T04:00:00+00:00"

    entries_by_name = {entry["name"]: entry for entry in by_league[1]["entries"]}
    assert entries_by_name["GOLD_PLAYER"]["gameUid"] == "1190060554000581"
    assert len(entries_by_name["GOLD_PLAYER"]["heroes"]) == 1
    assert entries_by_name["GOLD_PLAYER"]["heroes"][0]["heroId"] == 1001
    # The heroless entry still shows up, with an empty (not missing) list.
    assert entries_by_name["NO_LINEUP"]["heroes"] == []


def test_arena_endpoint_filters_by_league(tmp_path: Path) -> None:
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    _write_header(
        journal_path,
        observation_id="obs-gold",
        captured_at="2026-09-07T03:00:00+00:00",
        snapshot_id="gold-snap",
        league=1,
    )
    _write_header(
        journal_path,
        observation_id="obs-silver",
        captured_at="2026-09-07T04:00:00+00:00",
        snapshot_id="silver-snap",
        league=2,
    )

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/arena?league=2"
        with urllib.request.urlopen(url) as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert len(body["boards"]) == 1
    assert body["boards"][0]["league"] == 2


def test_arena_endpoint_rejects_a_non_numeric_league(base: str) -> None:
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(f"{base}/arena?league=gold")
    assert raised.value.code == 400
