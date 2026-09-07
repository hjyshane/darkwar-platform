"""Reading the local journal, which is a staging format rather than a schema.

Every target table is a JSON blob in `normalized_rows`, so these tests build
a journal by hand and assert on what comes back out.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from dw_collector.desktop import localread
from dw_collector.storage.journal import Journal


@pytest.fixture(autouse=True)
def _clear_fold_cache() -> None:
    """Isolate tests from each other's cache state.

    `_FOLD_CACHE` is now keyed on the journal FILE, not on a `tmp_path`
    fixture, so two tests could in principle collide on a reused path — and
    the tests below that assert on `len(_FOLD_CACHE)` need to know they are
    counting only their own entries, not ones left behind by whatever test
    ran before them in the same process. `_PLAYER_FOLD_CACHE` is the same
    cache pattern for `players.py` and needs the same isolation.
    """
    localread._FOLD_CACHE.clear()
    localread._PLAYER_FOLD_CACHE.clear()


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


def _write_player_row(
    journal: Journal,
    *,
    observation_id: str,
    captured_at: str,
    game_uid: int,
    source_command: str = "kill.rank",
    server_id: int = 581,
    name: str | None = "ERHA",
    alliance_external_id: str | None = None,
    hq_level: int | None = None,
    power: int | None = None,
    kills: int | None = None,
    rank: int | None = None,
) -> None:
    """One `player_snapshots` sighting, as one command's normalizer would have left it.

    Every keyword defaults to what `kill.rank` actually leaves null
    (`alliance_external_id`, `hq_level`, `power`) so a test only has to name
    the fields its scenario cares about.
    """
    journal.conn.execute(
        "insert or ignore into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values (?, ?, ?, ?, ?, ?, ?)",
        (
            observation_id,
            "00000000-0000-4000-8000-00000000c777",
            source_command,
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
            "alliance_external_id": alliance_external_id,
            "hq_level": hq_level,
            "power": power,
            "kills": kills,
            "rank": rank,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            localread.PLAYER_SNAPSHOTS,
            f"{observation_id}-{game_uid}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()


def _write_player_detail_row(
    journal: Journal,
    *,
    observation_id: str,
    captured_at: str,
    game_uid: int,
    server_id: int = 581,
    power_total: int | None = 100,
    power_components: dict[str, int] | None = None,
    components_sum_matches: bool | None = True,
) -> None:
    """One `player_detail_snapshots` row, as `get.new.user.info` would have left it."""
    journal.conn.execute(
        "insert or ignore into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values (?, ?, ?, ?, ?, ?, ?)",
        (
            observation_id,
            "00000000-0000-4000-8000-00000000c777",
            "get.new.user.info",
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
            "power_total": power_total,
            "power_components": power_components if power_components is not None else {},
            "components_sum_matches": components_sum_matches,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            localread.PLAYER_DETAIL,
            f"{observation_id}-{game_uid}",
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

    ASSERTING THE UID SET IS NOT ENOUGH, and an earlier version of this test
    did only that. With these fixtures a naive limit-before-fold returns the
    same two uids, because the first two rows happen to be one of each — so
    the test passed under exactly the bug it exists to catch. What separates
    the two implementations is WHICH sighting of the noisy player survives:
    folding first keeps its newest, limiting first keeps whichever row the
    limit happened to reach.
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
    kept = {tile.game_uid: tile.captured_at for tile in found}
    assert kept[1] == "2026-09-05T10:00:00+00:00"
    assert kept[2] == "2026-09-01T10:00:00+00:00"


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


def test_a_limit_of_zero_or_less_returns_nothing(tmp_path: Path) -> None:
    """A negative slice returns all-but-the-last, which looks like an answer."""
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        name="ERHA",
    )
    assert localread.search(journal.conn, "erha", limit=0) == []
    assert localread.search(journal.conn, "erha", limit=-1) == []
    # Sanity: it does return something with a sane limit.
    assert len(localread.search(journal.conn, "erha", limit=1)) == 1
    journal.close()


def test_the_fold_cache_invalidates_when_new_rows_arrive(tmp_path: Path) -> None:
    """A cache that serves a stale answer about where a player is is worse
    than a slow one.

    Task 3b's fold cache is keyed on `(max(id), count(*))` for
    `world_city_snapshots`, so any newly-recorded sighting changes the key
    and forces a fresh fold — this pins that a second search on the same
    connection sees a base that moved, rather than replaying the first
    answer.
    """
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        name="ERHA",
        x=100,
        y=200,
    )
    first = localread.search(journal.conn, "erha")
    assert len(first) == 1
    assert (first[0].x, first[0].y) == (100, 200)

    # The base was found again somewhere else, later — a real move, not a
    # duplicate sighting of the same spot.
    _write_tile(
        journal,
        observation_id="obs-2",
        captured_at="2026-09-02T10:00:00+00:00",
        game_uid=1,
        name="ERHA",
        x=555,
        y=777,
    )
    second = localread.search(journal.conn, "erha")
    journal.close()

    assert len(second) == 1
    assert (second[0].x, second[0].y) == (555, 777)


def test_the_cache_survives_a_new_connection_to_the_same_journal(
    tmp_path: Path,
) -> None:
    """THE BUG THIS CACHE WAS BORN WITH.

    The sidecar opens a fresh connection per request and closes it, so a
    cache keyed on the connection object missed every single time while
    still growing an entry per request. Keyed on the file, a second
    connection to the same journal reuses the fold.

    THIS REACHES INTO `localread._FOLD_CACHE`, A PRIVATE NAME, on purpose:
    the bug it pins was invisible from `search`'s return value alone — a
    connection-keyed cache and a file-keyed one answer every query the same
    way, they just disagree about how much work it took to get there. That
    is exactly why it shipped.
    """
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    first = sqlite3.connect(journal_path)
    localread.search(first, "erha")
    first.close()

    before = len(localread._FOLD_CACHE)
    second = sqlite3.connect(journal_path)
    localread.search(second, "erha")
    second.close()

    # One entry for one journal, no matter how many connections asked.
    assert len(localread._FOLD_CACHE) == before == 1


def test_two_journals_do_not_share_a_fold(tmp_path: Path) -> None:
    """Keying on a file means the key has to actually distinguish files."""
    first_path = tmp_path / "one.db"
    second_path = tmp_path / "two.db"
    for path, uid in ((first_path, 11), (second_path, 22)):
        journal = Journal(path)
        journal.init_db()
        _write_tile(
            journal,
            observation_id="obs-1",
            captured_at="2026-09-01T10:00:00+00:00",
            game_uid=uid,
            name="ERHA",
        )
        journal.close()

    first = sqlite3.connect(first_path)
    second = sqlite3.connect(second_path)
    found_first = localread.search(first, "erha")
    found_second = localread.search(second, "erha")
    first.close()
    second.close()

    assert [tile.game_uid for tile in found_first] == [11]
    assert [tile.game_uid for tile in found_second] == [22]


def test_deleting_rows_invalidates_the_fold(tmp_path: Path) -> None:
    """`Journal.prune` DOES delete from normalized_rows.

    The cache's freshness key survives that only because `id` is
    autoincrement and never reused, so a delete moves `count` without
    `max(id)` ever revisiting an old pairing. This pins that reasoning: a
    base that has been pruned away must stop being reported.
    """
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-old",
        captured_at="2020-01-01T00:00:00+00:00",
        game_uid=1,
        name="PRUNED",
    )
    _write_tile(
        journal,
        observation_id="obs-new",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=2,
        name="SURVIVOR",
    )

    before = localread.search(journal.conn, "runed") + localread.search(journal.conn, "urvivor")
    assert len(before) == 2

    # Real deletion, through the real deleter. `obs-old`'s captured_at is
    # old enough to be doomed and it has no sync_outbox entry, so nothing
    # holds it back (see `prune`'s `held_back` docstring).
    report = journal.prune(older_than=datetime(2025, 1, 1, tzinfo=UTC), confirm=True)
    assert report.observations == 1
    assert report.normalized_rows == 1
    assert report.held_back == 0

    pruned = localread.search(journal.conn, "runed")
    survivor = localread.search(journal.conn, "urvivor")
    journal.close()

    assert pruned == []
    assert len(survivor) == 1
    assert survivor[0].game_uid == 2


def test_two_sightings_sharing_a_timestamp_resolve_the_same_way_every_time(
    tmp_path: Path,
) -> None:
    """The tie-break, through real SQL rather than a hand-built list.

    Every other tie-break test calls `newest_per_player` directly, so none
    of them would notice if `_SELECT`'s ordering changed underneath them —
    and it did change, from `captured_at, n.id` to `n.id` alone.
    """
    journal = _journal(tmp_path)
    same_time = "2026-09-01T10:00:00+00:00"
    # Inserted first, so it gets the lower `n.id` and, per `_SELECT`'s
    # `order by n.id`, is the "first entry" that `newest_per_player` keeps
    # on an exact tie.
    _write_tile(
        journal,
        observation_id="obs-a",
        captured_at=same_time,
        game_uid=9,
        name="TIED",
        x=100,
        y=200,
    )
    _write_tile(
        journal,
        observation_id="obs-b",
        captured_at=same_time,
        game_uid=9,
        name="TIED",
        x=140,
        y=260,
    )

    first = localread.search(journal.conn, "tied")
    # Cleared BY HAND rather than relying on the autouse fixture: that
    # fixture only clears between tests, and this assertion needs a second,
    # genuinely fresh fold inside this one test to prove the winner is
    # reproduced from the same SQL ordering rather than served from cache.
    localread._FOLD_CACHE.clear()
    second = localread.search(journal.conn, "tied")
    journal.close()

    assert len(first) == 1
    assert len(second) == 1
    assert (first[0].x, first[0].y) == (100, 200)
    assert (second[0].x, second[0].y) == (100, 200)


# --------------------------------------------------------------------------
# Player profiles (Task 2): player_snapshots, folded across incompatible
# commands. See dw_collector.desktop.localread.players' module docstring for
# the merge rule and the honest limitation it accepts.
# --------------------------------------------------------------------------


def test_a_player_snapshot_comes_back_typed_with_its_capture_time(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
        source_command="kill.rank",
        kills=500,
        rank=3,
    )
    found = localread.player_snapshots(journal.conn)
    journal.close()

    assert len(found) == 1
    assert found[0].game_uid == 1190060554000581
    assert found[0].server_id == 581
    assert found[0].kills == 500
    assert found[0].rank == 3
    assert found[0].power is None
    assert found[0].hq_level is None
    assert found[0].captured_at == "2026-09-01T10:00:00+00:00"


def test_only_player_snapshot_rows_are_read(tmp_path: Path) -> None:
    # The journal holds many target tables in one place, world_city_snapshots
    # among them.
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=5,
    )
    found = localread.player_snapshots(journal.conn)
    journal.close()
    assert found == []


def test_a_player_row_that_is_not_json_is_skipped_rather_than_crashing(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-2', 'c', 'kill.rank', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-2', ?, 'bad', 'not json at all', 't')",
        (localread.PLAYER_SNAPSHOTS,),
    )
    journal.conn.commit()

    found = localread.player_snapshots(journal.conn)
    journal.close()
    assert len(found) == 1


def test_a_player_payload_that_is_not_an_object_is_skipped(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-good",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-shaped-wrong', 'c', 'kill.rank', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-shaped-wrong', ?, 'shaped-wrong', ?, 't')",
        (localread.PLAYER_SNAPSHOTS, json.dumps({"row": "oops"})),
    )
    journal.conn.commit()

    found = localread.player_snapshots(journal.conn)
    journal.close()
    assert len(found) == 1


def test_a_player_numeric_field_that_is_not_a_number_is_skipped(tmp_path: Path) -> None:
    """Present, non-null, and still not a number — `int()` is what fails."""
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-good",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-bad-power', 'c', 'server.rank', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-bad-power', ?, 'bad-power', ?, 't')",
        (
            localread.PLAYER_SNAPSHOTS,
            json.dumps({"row": {"game_uid": 2, "server_id": 581, "power": "not-a-number"}}),
        ),
    )
    journal.conn.commit()

    found = localread.player_snapshots(journal.conn)
    journal.close()
    assert len(found) == 1


def test_rows_without_a_game_uid_or_server_id_are_dropped_not_coerced(tmp_path: Path) -> None:
    """A profile filed under uid 0 would collide with every other row missing its uid."""
    journal = _journal(tmp_path)
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-1', 'c', 'kill.rank', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-1', ?, 'k', ?, 't')",
        (
            localread.PLAYER_SNAPSHOTS,
            json.dumps({"row": {"game_uid": 5, "server_id": None, "kills": 10}}),
        ),
    )
    journal.conn.commit()

    found = localread.player_snapshots(journal.conn)
    journal.close()
    assert found == []


def test_a_profile_assembled_from_a_single_command(tmp_path: Path) -> None:
    """The ordinary case: one command, one profile, its own nulls and all."""
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        source_command="server.rank",
        hq_level=40,
        power=5_000_000,
        rank=12,
    )
    profiles = localread.merge_player_snapshots(localread.player_snapshots(journal.conn))
    journal.close()

    assert len(profiles) == 1
    profile = profiles[0]
    assert profile.hq_level == 40
    assert profile.power == 5_000_000
    assert profile.rank == 12
    # server.rank never reports kills or an alliance — this profile is not
    # supposed to have opinions about them yet.
    assert profile.kills is None
    assert profile.alliance_external_id is None


def test_a_profile_merges_across_two_commands_with_complementary_nulls(
    tmp_path: Path,
) -> None:
    """THE ONE THAT MATTERS.

    kill.rank supplies kills and rank but never power or hq_level;
    server.rank supplies power and hq_level but never kills. A naive
    newest-row-wins fold would let whichever command answered last erase
    what the other one knew. Both must survive in the merged profile.
    """
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-kills",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        source_command="kill.rank",
        kills=9_000,
        rank=4,
    )
    _write_player_row(
        journal,
        observation_id="obs-power",
        captured_at="2026-09-02T10:00:00+00:00",
        game_uid=7,
        source_command="server.rank",
        hq_level=41,
        power=6_000_000,
        rank=55,
    )
    profiles = localread.merge_player_snapshots(localread.player_snapshots(journal.conn))
    journal.close()

    assert len(profiles) == 1
    profile = profiles[0]
    # From the older kill.rank row, and NOT erased by the newer server.rank
    # row's structural null.
    assert profile.kills == 9_000
    # From the newer server.rank row.
    assert profile.hq_level == 41
    assert profile.power == 6_000_000
    # rank was supplied by both — the newer one (server.rank's) wins.
    assert profile.rank == 55


def test_a_null_from_a_structurally_silent_command_does_not_erase_an_earlier_value(
    tmp_path: Path,
) -> None:
    """The half of the trap a whole-row fold gets backwards.

    get.user.info.multi supplies an alliance; kill.rank arrives LATER and
    structurally never reports one. The alliance must still be there — a
    whole-row "newest wins" fold would have wiped it out on the kill.rank
    row alone, which is exactly the bug this module exists to not have.
    """
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-multi",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=3,
        source_command="get.user.info.multi",
        alliance_external_id="ALLY-1",
        hq_level=30,
        power=1_000_000,
        kills=200,
    )
    _write_player_row(
        journal,
        observation_id="obs-kill-rank",
        captured_at="2026-09-05T10:00:00+00:00",
        game_uid=3,
        source_command="kill.rank",
        kills=250,
        rank=9,
    )
    profiles = localread.merge_player_snapshots(localread.player_snapshots(journal.conn))
    journal.close()

    assert len(profiles) == 1
    profile = profiles[0]
    assert profile.alliance_external_id == "ALLY-1"
    assert profile.hq_level == 30
    assert profile.power == 1_000_000
    # kills WAS reported by both — the newer kill.rank figure wins.
    assert profile.kills == 250
    assert profile.rank == 9


def test_the_newest_value_wins_when_both_commands_supply_the_same_field(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-old",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=8,
        source_command="server.rank",
        power=1_000_000,
        hq_level=30,
        rank=90,
    )
    _write_player_row(
        journal,
        observation_id="obs-new",
        captured_at="2026-09-03T10:00:00+00:00",
        game_uid=8,
        source_command="server.rank",
        power=2_500_000,
        hq_level=35,
        rank=40,
    )
    profiles = localread.merge_player_snapshots(localread.player_snapshots(journal.conn))
    journal.close()

    assert len(profiles) == 1
    assert profiles[0].power == 2_500_000
    assert profiles[0].hq_level == 35
    assert profiles[0].rank == 40


def test_captured_at_reflects_the_newest_contributing_observation(tmp_path: Path) -> None:
    """The merged `captured_at` is "when did we last see this player at all",

    not tied to any one field — see PlayerProfile's docstring. It must equal
    the newer row's time even though that row only updated `kills`.
    """
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-power",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=4,
        source_command="server.rank",
        power=3_000_000,
        hq_level=38,
        rank=20,
    )
    _write_player_row(
        journal,
        observation_id="obs-kills",
        captured_at="2026-09-04T10:00:00+00:00",
        game_uid=4,
        source_command="kill.rank",
        kills=777,
        rank=5,
    )
    profiles = localread.merge_player_snapshots(localread.player_snapshots(journal.conn))
    journal.close()

    assert len(profiles) == 1
    profile = profiles[0]
    assert profile.captured_at == "2026-09-04T10:00:00+00:00"
    # And the fields that observation didn't touch are still intact.
    assert profile.power == 3_000_000
    assert profile.hq_level == 38


def test_the_same_uid_on_two_servers_stays_two_profiles(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-a",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        server_id=580,
    )
    _write_player_row(
        journal,
        observation_id="obs-b",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        server_id=581,
    )
    profiles = localread.merge_player_snapshots(localread.player_snapshots(journal.conn))
    journal.close()
    assert len(profiles) == 2


def test_merged_profiles_come_back_newest_first(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-older",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        name="OLDER",
    )
    _write_player_row(
        journal,
        observation_id="obs-newer",
        captured_at="2026-09-03T10:00:00+00:00",
        game_uid=2,
        name="NEWER",
    )
    profiles = localread.merge_player_snapshots(localread.player_snapshots(journal.conn))
    journal.close()
    assert [p.game_uid for p in profiles] == [2, 1]


def test_search_players_matches_by_uid_and_name(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
        name="ERHA SANGMAIMA",
    )
    by_uid = localread.search_players(journal.conn, "1190060554000581")
    by_name = localread.search_players(journal.conn, "sangmai")
    journal.close()

    assert len(by_uid) == 1
    assert len(by_name) == 1


def test_the_player_fold_cache_invalidates_when_new_rows_arrive(tmp_path: Path) -> None:
    """A cache serving a stale power figure is worse than a slow one."""
    journal = _journal(tmp_path)
    _write_player_row(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        source_command="server.rank",
        power=1_000_000,
    )
    first = localread.search_players(journal.conn, "erha")
    assert first[0].power == 1_000_000

    _write_player_row(
        journal,
        observation_id="obs-2",
        captured_at="2026-09-02T10:00:00+00:00",
        game_uid=1,
        source_command="server.rank",
        power=9_000_000,
    )
    second = localread.search_players(journal.conn, "erha")
    journal.close()

    assert second[0].power == 9_000_000


def test_the_player_cache_is_keyed_on_the_file_not_the_connection(
    tmp_path: Path,
) -> None:
    """The same bug `_FOLD_CACHE` was born with, one projection over."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    first = sqlite3.connect(journal_path)
    localread.search_players(first, "erha")
    first.close()

    before = len(localread._PLAYER_FOLD_CACHE)
    second = sqlite3.connect(journal_path)
    localread.search_players(second, "erha")
    second.close()

    assert len(localread._PLAYER_FOLD_CACHE) == before == 1


# --------------------------------------------------------------------------
# Player power breakdown (Task 2): player_detail_snapshots, single writer.
# See dw_collector.desktop.localread.player_detail's module docstring for why
# this stays a separate projection from PlayerProfile.
# --------------------------------------------------------------------------


def test_a_matching_component_breakdown_is_surfaced_as_matching(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_player_detail_row(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        power_total=100,
        power_components={"armyPower": 60, "heroPower": 40},
        components_sum_matches=True,
    )
    details = localread.player_details(journal.conn)
    journal.close()

    assert len(details) == 1
    assert details[0].power_total == 100
    assert details[0].power_components == {"armyPower": 60, "heroPower": 40}
    assert details[0].components_sum_matches is True


def test_a_mismatched_component_breakdown_is_surfaced_as_false_not_hidden(
    tmp_path: Path,
) -> None:
    """A profile whose parts do not add up must not be presented as exact.

    `components_sum_matches=False` has to survive the read distinctly from
    `None` ("too few components to check") and from being silently dropped.
    """
    journal = _journal(tmp_path)
    _write_player_detail_row(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        power_total=100,
        power_components={"armyPower": 60, "heroPower": 30},
        components_sum_matches=False,
    )
    details = localread.player_details(journal.conn)
    journal.close()

    assert details[0].components_sum_matches is False
    assert details[0].power_total == 100


def test_a_component_breakdown_with_too_few_components_reports_unknown_not_matching(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    _write_player_detail_row(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        power_total=100,
        power_components={},
        components_sum_matches=None,
    )
    details = localread.player_details(journal.conn)
    journal.close()

    assert details[0].components_sum_matches is None
    assert details[0].power_components == {}


def test_a_malformed_player_detail_row_is_skipped_without_killing_the_read(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    _write_player_detail_row(
        journal,
        observation_id="obs-good",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-bad', 'c', 'get.new.user.info', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-bad', ?, 'bad', ?, 't')",
        (
            localread.PLAYER_DETAIL,
            # components_sum_matches must be a bool or null — a string here
            # is exactly the kind of shape drift the guard exists to catch.
            json.dumps(
                {
                    "row": {
                        "game_uid": 2,
                        "server_id": 581,
                        "power_total": 50,
                        "power_components": {},
                        "components_sum_matches": "yes",
                    }
                }
            ),
        ),
    )
    journal.conn.commit()

    details = localread.player_details(journal.conn)
    journal.close()
    assert len(details) == 1
    assert details[0].game_uid == 1


def test_newest_detail_per_player_keeps_the_latest_profile_open(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_player_detail_row(
        journal,
        observation_id="obs-old",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
        power_total=100,
        components_sum_matches=True,
    )
    _write_player_detail_row(
        journal,
        observation_id="obs-new",
        captured_at="2026-09-05T10:00:00+00:00",
        game_uid=1,
        power_total=200,
        components_sum_matches=False,
    )
    newest = localread.newest_detail_per_player(localread.player_details(journal.conn))
    journal.close()

    assert len(newest) == 1
    assert newest[0].power_total == 200
    assert newest[0].components_sum_matches is False
