"""Reading the local journal, which is a staging format rather than a schema.

Every target table is a JSON blob in `normalized_rows`, so these tests build
a journal by hand and assert on what comes back out.
"""

from __future__ import annotations

import json
from pathlib import Path

from dw_collector.desktop import localread
from dw_collector.storage.journal import Journal


def _journal(tmp_path: Path) -> Journal:
    journal = Journal(tmp_path / "collector.db")
    journal.init_db()
    return journal


def _write_tile(
    journal: Journal,
    *,
    observation_id: str,
    captured_at: str,
    game_uid: int,
    server_id: int = 581,
    name: str | None = "ERHA",
    x: int = 100,
    y: int = 200,
    hq_level: int | None = 34,
) -> None:
    """One sighting, as the normalizer would have left it."""
    journal.conn.execute(
        "insert or ignore into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values (?, ?, ?, ?, ?, ?, ?)",
        (
            observation_id,
            "00000000-0000-4000-8000-00000000c777",
            "world.get.new",
            captured_at,
            580,
            "{}",
            captured_at,
        ),
    )
    row = {
        "row": {
            "game_uid": game_uid,
            "server_id": server_id,
            "name": name,
            "x": x,
            "y": y,
            "hq_level": hq_level,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            localread.WORLD_CITY,
            f"{observation_id}-{game_uid}-{x}-{y}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()


def test_a_tile_comes_back_typed_with_its_capture_time(tmp_path: Path) -> None:
    # captured_at lives on raw_observations, not in row_json, so this also
    # pins that the read joins the two tables.
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
    )
    found = localread.tiles(journal.conn)
    journal.close()

    assert len(found) == 1
    assert found[0].game_uid == 1190060554000581
    assert found[0].server_id == 581
    assert found[0].x == 100
    assert found[0].y == 200
    assert found[0].hq_level == 34
    assert found[0].captured_at == "2026-09-01T10:00:00+00:00"


def test_a_row_that_is_not_json_is_skipped_rather_than_crashing(
    tmp_path: Path,
) -> None:
    """A journal is written by a parser that changes. One bad row must not
    take out the whole screen."""
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-2', 'c', 'world.get.new', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-2', ?, 'bad', 'not json at all', 't')",
        (localread.WORLD_CITY,),
    )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()
    assert len(found) == 1


def test_rows_without_a_coordinate_are_dropped_not_coerced(
    tmp_path: Path,
) -> None:
    """A pin drawn from a coerced null lands at 0,0 and looks real."""
    journal = _journal(tmp_path)
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-1', 'c', 'world.get.new', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-1', ?, 'k', ?, 't')",
        (
            localread.WORLD_CITY,
            json.dumps({"row": {"game_uid": 5, "server_id": 581, "x": None, "y": 2}}),
        ),
    )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()
    assert found == []


def test_only_world_city_rows_are_read(tmp_path: Path) -> None:
    # The journal holds seventeen target tables in one place.
    journal = _journal(tmp_path)
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-1', 'c', 'player.detail', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-1', 'player_snapshots', 'k', ?, 't')",
        (json.dumps({"row": {"game_uid": 5, "server_id": 581, "x": 1, "y": 2}}),),
    )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()
    assert found == []
