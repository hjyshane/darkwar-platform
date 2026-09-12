"""Arena bracket projection: `arena_snapshots` + `arena_entries` +
`arena_entry_heroes`, joined in Python and folded to the newest snapshot per
league — see `dw_collector.desktop.localread.arena`'s module docstring for
exactly which fields link the three tables and why the league dimension is
folded separately.

Journal rows are built by hand, same as `test_desktop_localread.py`, using
the exact column names `dw_collector.normalize.arena.normalize` writes — see
that module for the source of truth on shape.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from dw_collector.desktop import localread
from dw_collector.storage.journal import Journal


@pytest.fixture(autouse=True)
def _clear_fold_cache() -> None:
    """Isolate tests from each other's cache state — same reasoning as
    `test_desktop_localread.py`'s own autouse fixture."""
    localread._ARENA_FOLD_CACHE.clear()


def _journal(tmp_path: Path) -> Journal:
    journal = Journal(tmp_path / "collector.db")
    journal.init_db()
    return journal


def _write_raw_observation(
    conn: sqlite3.Connection, *, observation_id: str, captured_at: str
) -> None:
    conn.execute(
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
    journal: Journal,
    *,
    observation_id: str,
    captured_at: str,
    snapshot_id: str,
    server_id: int = 580,
    week_start: str = "2026-09-07T02:00:00+00:00",
    entry_count: int | None = 2,
    league: int | None = 1,
) -> None:
    """One `arena_snapshots` header row, as `normalize.arena` would have left it."""
    _write_raw_observation(journal.conn, observation_id=observation_id, captured_at=captured_at)
    row = {
        "row": {
            "snapshot_id": snapshot_id,
            "server_id": server_id,
            "week_start": week_start,
            "entry_count": entry_count,
            "league": league,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            localread.ARENA_SNAPSHOTS,
            f"header-{snapshot_id}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()


def _write_entry(
    journal: Journal,
    *,
    observation_id: str,
    captured_at: str,
    entry_id: str,
    arena_snapshot_id: str,
    game_uid: int,
    rank: int,
    server_id: int = 581,
    name: str | None = "ERHA",
    score: int | None = 5000,
    defense_power: int | None = 1_000_000,
    alliance_name: str | None = "Erha's Legion",
    alliance_code: str | None = "ERHA",
) -> None:
    """One `arena_entries` row, as `normalize.arena` would have left it."""
    _write_raw_observation(journal.conn, observation_id=observation_id, captured_at=captured_at)
    row = {
        "row": {
            "snapshot_id": entry_id,
            "arena_snapshot_id": arena_snapshot_id,
            "server_id": server_id,
            "game_uid": game_uid,
            "name": name,
            "rank": rank,
            "score": score,
            "defense_power": defense_power,
            "alliance_name": alliance_name,
            "alliance_code": alliance_code,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            localread.ARENA_ENTRIES,
            f"entry-{entry_id}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()


def _write_hero(
    journal: Journal,
    *,
    observation_id: str,
    captured_at: str,
    arena_entry_id: str,
    hero_id: int,
    slot: int | None = 1,
    troop_class: int | None = 2,
    hero_level: int | None = 60,
    level_synced: bool = False,
    star: int | None = 5,
    stage: int | None = 2,
    hero_power: int | None = 200_000,
    weapon_level: int | None = 20,
) -> None:
    """One `arena_entry_heroes` row, as `normalize.arena._lineup_rows` would
    have left it."""
    _write_raw_observation(journal.conn, observation_id=observation_id, captured_at=captured_at)
    row = {
        "row": {
            "arena_entry_id": arena_entry_id,
            "slot": slot,
            "hero_id": hero_id,
            "troop_class": troop_class,
            "hero_level": hero_level,
            "level_synced": level_synced,
            "star": star,
            "stage": stage,
            "hero_power": hero_power,
            "weapon_level": weapon_level,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            localread.ARENA_ENTRY_HEROES,
            f"hero-{arena_entry_id}-{hero_id}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()


def test_two_snapshots_of_the_same_league_the_newer_wins(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_header(
        journal,
        observation_id="obs-old",
        captured_at="2026-08-31T02:00:00+00:00",
        snapshot_id="snap-old",
        week_start="2026-08-31T02:00:00+00:00",
        league=1,
    )
    _write_header(
        journal,
        observation_id="obs-new",
        captured_at="2026-09-07T02:00:00+00:00",
        snapshot_id="snap-new",
        week_start="2026-09-07T02:00:00+00:00",
        league=1,
    )
    boards = localread.arena(journal.conn)
    journal.close()

    assert len(boards) == 1
    assert boards[0].header.snapshot_id == "snap-new"


def test_two_leagues_each_keep_their_own_newest(tmp_path: Path) -> None:
    """Not one bracket overwriting the other: Gold and Silver each keep the
    newest header of their OWN lineage, even when Silver's newest capture is
    older than Gold's."""
    journal = _journal(tmp_path)
    _write_header(
        journal,
        observation_id="obs-gold-old",
        captured_at="2026-08-31T02:00:00+00:00",
        snapshot_id="gold-old",
        league=1,
    )
    _write_header(
        journal,
        observation_id="obs-gold-new",
        captured_at="2026-09-07T02:00:00+00:00",
        snapshot_id="gold-new",
        league=1,
    )
    _write_header(
        journal,
        observation_id="obs-silver-only",
        captured_at="2026-09-01T02:00:00+00:00",
        snapshot_id="silver-only",
        league=2,
    )
    boards = localread.arena(journal.conn)
    journal.close()

    by_league = {board.header.league: board.header.snapshot_id for board in boards}
    assert by_league == {1: "gold-new", 2: "silver-only"}


def test_entries_attach_to_the_right_snapshot(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_header(
        journal,
        observation_id="obs-gold",
        captured_at="2026-09-07T02:00:00+00:00",
        snapshot_id="gold-snap",
        league=1,
    )
    _write_header(
        journal,
        observation_id="obs-silver",
        captured_at="2026-09-07T02:00:00+00:00",
        snapshot_id="silver-snap",
        league=2,
    )
    _write_entry(
        journal,
        observation_id="obs-gold",
        captured_at="2026-09-07T02:00:00+00:00",
        entry_id="entry-gold-1",
        arena_snapshot_id="gold-snap",
        game_uid=1,
        rank=1,
        name="GOLD_PLAYER",
    )
    _write_entry(
        journal,
        observation_id="obs-silver",
        captured_at="2026-09-07T02:00:00+00:00",
        entry_id="entry-silver-1",
        arena_snapshot_id="silver-snap",
        game_uid=2,
        rank=1,
        name="SILVER_PLAYER",
    )
    boards = localread.arena(journal.conn)
    journal.close()

    by_league = {board.header.league: board for board in boards}
    assert [e.name for e in by_league[1].entries] == ["GOLD_PLAYER"]
    assert [e.name for e in by_league[2].entries] == ["SILVER_PLAYER"]


def test_heroes_attach_to_the_right_entry(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_header(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        snapshot_id="snap-1",
        league=1,
    )
    _write_entry(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        entry_id="entry-1",
        arena_snapshot_id="snap-1",
        game_uid=1,
        rank=1,
        name="FIRST",
    )
    _write_entry(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        entry_id="entry-2",
        arena_snapshot_id="snap-1",
        game_uid=2,
        rank=2,
        name="SECOND",
    )
    _write_hero(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        arena_entry_id="entry-1",
        hero_id=1001,
        slot=1,
    )
    _write_hero(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        arena_entry_id="entry-2",
        hero_id=2002,
        slot=1,
    )
    boards = localread.arena(journal.conn)
    journal.close()

    entries_by_name = {entry.name: entry for entry in boards[0].entries}
    assert [hero.hero_id for hero in entries_by_name["FIRST"].heroes] == [1001]
    assert [hero.hero_id for hero in entries_by_name["SECOND"].heroes] == [2002]


def test_an_entry_with_no_heroes_still_appears(tmp_path: Path) -> None:
    """A bracket that hides a player because their lineup did not parse is
    worse than one showing them without it — see the module docstring."""
    journal = _journal(tmp_path)
    _write_header(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        snapshot_id="snap-1",
        league=1,
    )
    _write_entry(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        entry_id="entry-no-heroes",
        arena_snapshot_id="snap-1",
        game_uid=1,
        rank=1,
        name="NO_HEROES",
    )
    _write_entry(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        entry_id="entry-with-heroes",
        arena_snapshot_id="snap-1",
        game_uid=2,
        rank=2,
        name="WITH_HEROES",
    )
    _write_hero(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-07T02:00:00+00:00",
        arena_entry_id="entry-with-heroes",
        hero_id=1001,
    )
    boards = localread.arena(journal.conn)
    journal.close()

    entries_by_name = {entry.name: entry for entry in boards[0].entries}
    assert "NO_HEROES" in entries_by_name
    assert entries_by_name["NO_HEROES"].heroes == ()
    assert len(entries_by_name["WITH_HEROES"].heroes) == 1


def test_a_malformed_header_row_is_skipped_rather_than_crashing(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_header(
        journal,
        observation_id="obs-good",
        captured_at="2026-09-07T02:00:00+00:00",
        snapshot_id="snap-good",
        league=1,
    )
    _write_raw_observation(
        journal.conn, observation_id="obs-bad", captured_at="2026-09-07T02:00:00+00:00"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            "obs-bad",
            localread.ARENA_SNAPSHOTS,
            "header-bad",
            "not json at all",
            "2026-09-07T02:00:00+00:00",
        ),
    )
    journal.conn.commit()

    headers = localread.arena_header_rows(journal.conn)
    journal.close()
    assert len(headers) == 1
    assert headers[0].snapshot_id == "snap-good"


def test_a_malformed_entry_row_is_skipped_rather_than_crashing(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_entry(
        journal,
        observation_id="obs-good",
        captured_at="2026-09-07T02:00:00+00:00",
        entry_id="entry-good",
        arena_snapshot_id="snap-1",
        game_uid=1,
        rank=1,
    )
    _write_raw_observation(
        journal.conn, observation_id="obs-bad", captured_at="2026-09-07T02:00:00+00:00"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            "obs-bad",
            localread.ARENA_ENTRIES,
            "entry-bad",
            json.dumps({"row": "oops"}),
            "2026-09-07T02:00:00+00:00",
        ),
    )
    journal.conn.commit()

    entries = localread.arena_entry_rows(journal.conn)
    journal.close()
    assert len(entries) == 1
    assert entries[0].entry_id == "entry-good"


def test_a_malformed_hero_row_is_skipped_rather_than_crashing(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_hero(
        journal,
        observation_id="obs-good",
        captured_at="2026-09-07T02:00:00+00:00",
        arena_entry_id="entry-1",
        hero_id=1001,
    )
    _write_raw_observation(
        journal.conn, observation_id="obs-bad", captured_at="2026-09-07T02:00:00+00:00"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            "obs-bad",
            localread.ARENA_ENTRY_HEROES,
            "hero-bad",
            "{not even json",
            "2026-09-07T02:00:00+00:00",
        ),
    )
    journal.conn.commit()

    heroes = localread.arena_hero_rows(journal.conn)
    journal.close()
    assert len(heroes) == 1
    assert heroes[0].hero_id == 1001


def test_only_arena_rows_are_read(tmp_path: Path) -> None:
    """The journal holds many target tables in one place — `arena_header_rows`
    must not pick up a row written for a different table."""
    journal = _journal(tmp_path)
    _write_raw_observation(
        journal.conn, observation_id="obs-1", captured_at="2026-09-07T02:00:00+00:00"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            "obs-1",
            "world_city",
            "not-arena",
            json.dumps({"row": {"game_uid": 1, "server_id": 581, "x": 1, "y": 1}}),
            "2026-09-07T02:00:00+00:00",
        ),
    )
    journal.conn.commit()

    assert localread.arena_header_rows(journal.conn) == []
    assert localread.arena_entry_rows(journal.conn) == []
    assert localread.arena_hero_rows(journal.conn) == []


def test_arena_is_empty_for_a_journal_with_no_arena_rows(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    boards = localread.arena(journal.conn)
    journal.close()
    assert boards == []
