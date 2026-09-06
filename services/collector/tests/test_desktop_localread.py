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


def test_a_payload_that_is_not_an_object_is_skipped(tmp_path: Path) -> None:
    """Valid JSON, wrong shape.

    This one gets past `json.loads` and dies on `.get` instead, which is a
    different exception in a different place from a decode failure — and it
    is the one a parser change is most likely to introduce.
    """
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-good",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-shaped-wrong', 'c', 'world.get.new', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-shaped-wrong', ?, 'shaped-wrong', ?, 't')",
        (localread.WORLD_CITY, json.dumps({"row": "oops"})),
    )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()
    assert len(found) == 1


def test_a_coordinate_that_is_not_a_number_is_skipped(tmp_path: Path) -> None:
    """Present, non-null, and still not a coordinate.

    The None checks pass and `int()` is what fails, one line further on.
    """
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-good",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-not-a-number', 'c', 'world.get.new', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-not-a-number', ?, 'not-a-number', ?, 't')",
        (
            localread.WORLD_CITY,
            json.dumps({"row": {"game_uid": 2, "server_id": 581, "x": "abc", "y": 5}}),
        ),
    )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()
    assert len(found) == 1


def test_one_observation_holds_many_tiles(tmp_path: Path) -> None:
    """The ordinary case, and the fixtures above never exercise it.

    One `world.get.new` response is a viewport, and a viewport is thousands
    of tiles — so the join is one-to-many and every real capture depends on
    it being read that way.
    """
    journal = _journal(tmp_path)
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-1', 'c', 'world.get.new', "
        "'2026-09-01T10:00:00+00:00', 580, '{}', 't')"
    )
    for uid in (11, 12, 13):
        journal.conn.execute(
            "insert into normalized_rows "
            "(observation_id, target_table, idempotency_key, row_json, created_at) "
            "values ('obs-1', ?, ?, ?, 't')",
            (
                localread.WORLD_CITY,
                f"tile-{uid}",
                json.dumps(
                    {
                        "row": {
                            "game_uid": uid,
                            "server_id": 581,
                            "name": None,
                            "x": uid,
                            "y": uid,
                            "hq_level": None,
                        }
                    }
                ),
            ),
        )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()

    assert len(found) == 3
    # All three share the observation's time, because that is where the time
    # lives.
    assert {tile.captured_at for tile in found} == {"2026-09-01T10:00:00+00:00"}


def test_one_row_per_player_at_the_newest_sighting(tmp_path: Path) -> None:
    """A sweep writes a row per tile per pan, and pans overlap.

    One base near the edge of a sweep is written once per viewport that
    caught it. Four rows for one tile reads as four findings.
    """
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-old",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        x=100,
        y=200,
    )
    _write_tile(
        journal,
        observation_id="obs-new",
        captured_at="2026-09-02T10:00:00+00:00",
        game_uid=7,
        x=140,
        y=260,
    )
    newest = localread.newest_per_player(localread.tiles(journal.conn))
    journal.close()

    assert len(newest) == 1
    # The base moved. The newest sighting is the answer, not the first one.
    assert (newest[0].x, newest[0].y) == (140, 260)


def test_the_same_uid_on_two_servers_stays_two_players(tmp_path: Path) -> None:
    # Keyed on (server_id, game_uid), matching latest_world_cities.
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-a",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        server_id=580,
    )
    _write_tile(
        journal,
        observation_id="obs-b",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        server_id=581,
    )
    newest = localread.newest_per_player(localread.tiles(journal.conn))
    journal.close()
    assert len(newest) == 2


def test_the_fold_compares_times_rather_than_trusting_arrival_order() -> None:
    """An implementation that just let the last entry win would pass every
    journal-backed test here, because `tiles()` returns rows oldest-first.
    Only handing the function a reversed list tells the two apart."""
    old = localread.Tile(
        game_uid=7,
        server_id=581,
        name="ERHA",
        x=100,
        y=200,
        hq_level=34,
        captured_at="2026-09-01T10:00:00+00:00",
    )
    new = localread.Tile(
        game_uid=7,
        server_id=581,
        name="ERHA",
        x=140,
        y=260,
        hq_level=34,
        captured_at="2026-09-02T10:00:00+00:00",
    )
    assert localread.newest_per_player([new, old]) == [new]
    assert localread.newest_per_player([old, new]) == [new]


def test_the_fold_returns_players_newest_first() -> None:
    """The docstring promises an order and nothing checked it.

    The map draws these in the order it gets them, so a reversed list puts
    the stalest sighting at the top of the screen.
    """
    older = localread.Tile(
        game_uid=1,
        server_id=581,
        name="OLDER",
        x=1,
        y=1,
        hq_level=None,
        captured_at="2026-09-01T10:00:00+00:00",
    )
    newer = localread.Tile(
        game_uid=2,
        server_id=581,
        name="NEWER",
        x=2,
        y=2,
        hq_level=None,
        captured_at="2026-09-03T10:00:00+00:00",
    )
    folded = localread.newest_per_player([older, newer])
    assert [tile.game_uid for tile in folded] == [2, 1]


def test_a_uid_matches_whole_and_a_name_matches_loosely(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
        name="ERHA SANGMAIMA",
    )
    by_uid = localread.search(journal.conn, "1190060554000581")
    by_name = localread.search(journal.conn, "sangmai")
    # The last six digits of a uid are the server. A substring match would
    # return every player on 581 — the opposite of narrowing.
    by_suffix = localread.search(journal.conn, "000581")
    journal.close()

    assert len(by_uid) == 1
    assert len(by_name) == 1
    assert by_suffix == []


def test_the_limit_counts_players_not_sightings(tmp_path: Path) -> None:
    """THE TRAP THIS REPO HAS ALREADY PAID FOR, one level down.

    Limiting before folding lets one heavily-swept base eat the whole
    budget, and the other players do not come back late or stale — they are
    absent. Fold first, then limit.
    """
    journal = _journal(tmp_path)
    for pan in range(5):
        _write_tile(
            journal,
            observation_id=f"obs-noisy-{pan}",
            captured_at=f"2026-09-0{pan + 1}T10:00:00+00:00",
            game_uid=1,
            name="NOISY",
        )
    _write_tile(
        journal,
        observation_id="obs-quiet",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=2,
        name="NOISY TOO",
    )
    found = localread.search(journal.conn, "noisy", limit=2)
    journal.close()

    assert {tile.game_uid for tile in found} == {1, 2}


def test_an_empty_needle_returns_nothing(tmp_path: Path) -> None:
    # Otherwise an empty box returns the entire journal.
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    assert localread.search(journal.conn, "") == []
    assert localread.search(journal.conn, "   ") == []
    journal.close()
