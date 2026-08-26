"""world.get.new — the map viewport, of which only cities are stored.

The fixture is a real 657-tile viewport with the people masked, so these
assertions run against the shape the server actually sends rather than
against a hand-built one.
"""

from __future__ import annotations

from dw_collector import registry
from dw_collector.normalize import world_map
from tests.conftest import load_observation

VIEWPORT = "world.get.new/season3_viewport_v1.json"
# A pan over ground dense with members' season buildings: 256 of them.
BUILDINGS = "world.get.new/season3_buildings_v1.json"


#: A viewport now also writes one row about ITSELF — where the camera looked
#: — and that row has no uid, no coordinate and no player. The assertions
#: about tiles want the tiles, so they say so rather than assuming every row
#: in the list is one.
TILE_TABLES = {"world_city_snapshots", "season_building_snapshots"}


def tile_rows(observation: object) -> list:  # type: ignore[type-arg]
    return [r for r in world_map.normalize(observation) if r.target_table in TILE_TABLES]  # type: ignore[arg-type]


def test_registered() -> None:
    assert registry.get("world.get.new") is world_map.normalize


def test_cities_and_season_buildings_are_written() -> None:
    """Two tables from one viewport. Everything else — resources, alliance
    buildings, the eight types nobody has opened — stays out, because a row
    for any of them would be a column full of guesses."""
    observation = load_observation(VIEWPORT)

    rows = world_map.normalize(observation)
    tables = {r.target_table for r in rows}

    assert tables <= {
        "world_city_snapshots",
        "season_building_snapshots",
        "world_viewport_snapshots",
    }
    cities = [r for r in rows if r.target_table == "world_city_snapshots"]
    assert len(cities) == 134


def test_a_building_records_a_level_that_only_rises() -> None:
    """The property that separates a level from a variant id. Type 21 has a
    lookalike field that failed this three ways; this one passed it with
    1,536 increases and zero decreases across 1,720 tracked objects."""
    rows = [
        r
        for r in world_map.normalize(load_observation(BUILDINGS))
        if r.target_table == "season_building_snapshots"
    ]
    levels = [r.row["level"] for r in rows if r.row["level"] is not None]

    assert levels
    assert min(levels) >= 1
    # Buildings of one type at many levels is the whole point of the board.
    assert len(set(levels)) > 1


def test_a_season_building_carries_its_owner_type_and_level() -> None:
    """The surface the alliance asked for. Type 6 was labelled marches in
    this repo until 22 buildings were clicked and every one came back as
    type 6 matching its owner's uid."""
    rows = [
        r
        for r in world_map.normalize(load_observation(BUILDINGS))
        if r.target_table == "season_building_snapshots"
    ]

    assert len(rows) == 256
    for row in rows:
        assert row.row["game_uid"] > 0
        assert row.row["server_id"] == int(str(row.row["game_uid"])[-6:])
        assert row.row["point_id"] == row.row["y"] * 1000 + row.row["x"] + 1
        if row.row["level"] is not None:
            assert row.row["level"] >= 1


def test_a_building_is_keyed_by_object_not_by_tile() -> None:
    """A coordinate can be rebuilt on; an object cannot. Keying on the tile
    would merge two buildings' histories into one patch of ground."""
    rows = [
        r
        for r in world_map.normalize(load_observation(BUILDINGS))
        if r.target_table == "season_building_snapshots"
    ]

    assert len({r.idempotency_key for r in rows}) == len(rows)
    assert all("building:" in r.idempotency_key for r in rows)


def test_the_coordinate_is_stored_unpacked_and_packed() -> None:
    """ROW FIRST, COLUMN ONE-BASED: `point_id = y * 1000 + (x + 1)`.

    The invariant was written the other way round and held for months
    because it is self-consistent — the normalizer and the test agreed with
    each other and both disagreed with the game. Only two members reading
    their own coordinates off screen caught it.
    """
    rows = tile_rows(load_observation(VIEWPORT))

    for row in rows:
        assert row.row["point_id"] == row.row["y"] * 1000 + row.row["x"] + 1
        assert 0 <= row.row["x"] < 1000
        assert 0 <= row.row["y"] < 1000


def test_every_city_carries_a_uid_and_its_server() -> None:
    """server_id is the SUBJECT's, decoded from the uid — the map reaches
    servers outside the tracked group just as the season boards do."""
    rows = tile_rows(load_observation(VIEWPORT))

    for row in rows:
        uid = str(row.row["game_uid"])
        assert row.row["server_id"] == int(uid[-6:])
    assert {r.row["collected_from_server_id"] for r in rows} == {580}


def test_hq_level_is_kept_where_the_tile_carries_one() -> None:
    rows = [r for r in tile_rows(load_observation(VIEWPORT)) if "hq_level" in r.row]
    levels = [r.row["hq_level"] for r in rows if r.row["hq_level"] is not None]

    assert levels, "the fixture should carry HQ levels"
    # A real range: the map shows established players, not fresh accounts.
    assert min(levels) >= 1
    assert max(levels) <= 60


def test_each_row_carries_the_player_ref_sync_needs() -> None:
    rows = tile_rows(load_observation(VIEWPORT))

    ref = rows[0].entity_refs["player"]
    assert ref["game_uid"] == rows[0].row["game_uid"]
    assert ref["server_id"] == rows[0].row["server_id"]
    # Resolved cloud-side, never invented here.
    assert "player_id" not in rows[0].row


def test_two_tiles_do_not_collide_on_one_key() -> None:
    rows = world_map.normalize(load_observation(VIEWPORT))

    assert len({r.idempotency_key for r in rows}) == len(rows)


def test_a_viewport_with_no_points_still_records_that_it_looked() -> None:
    """THIS ASSERTION USED TO BE THE OPPOSITE, and the old one was the bug.

    Empty ground is most of the map and it produces no city row, so "no rows
    here" meant either "never swept" or "swept, nobody lives there" with
    nothing to tell them apart. A sweeper reading that would re-walk the empty
    half of the world forever and never learn it was empty.
    """
    observation = load_observation(VIEWPORT)
    empty = observation.model_copy(update={"payload": {**observation.payload, "points": []}})

    rows = world_map.normalize(empty)

    assert [r.target_table for r in rows] == ["world_viewport_snapshots"]
    assert rows[0].row["object_count"] == 0
    # No objects means no box. The covered region comes from the centre and
    # the measured half-extents, never from where the objects happened to be.
    assert rows[0].row["min_x"] is None


def test_a_viewport_that_does_not_say_where_it_looked_records_nothing() -> None:
    """A centre is the whole point of the row. Defaulting a missing one to
    0,0 would mark the map's corner swept on the strength of a payload that
    never mentioned it."""
    observation = load_observation(VIEWPORT)

    assert world_map.normalize(observation.model_copy(update={"payload": {}})) == []


def test_the_viewport_row_carries_the_camera_and_the_zoom() -> None:
    """viewLvl is stored because 2 returns no tiles at all while the game
    still draws a normal map — a sweep that ran there would look successful
    and cover nothing, and this column is how that gets caught afterwards."""
    observation = load_observation(VIEWPORT)

    viewport = next(
        r for r in world_map.normalize(observation) if r.target_table == "world_viewport_snapshots"
    )

    assert viewport.row["center_x"] == observation.payload["x"]
    assert viewport.row["center_y"] == observation.payload["y"]
    assert viewport.row["view_lvl"] == observation.payload["viewLvl"]
    # The MAP's server, not a server decoded from some city's uid.
    assert viewport.row["server_id"] == observation.payload["serverId"]


def test_one_viewport_row_per_response() -> None:
    rows = world_map.normalize(load_observation(VIEWPORT))

    assert len([r for r in rows if r.target_table == "world_viewport_snapshots"]) == 1


def test_a_malformed_point_is_skipped_without_losing_the_viewport() -> None:
    """One unreadable entry among 657 is a decoder gap to find, not a reason
    to drop the other 656."""
    observation = load_observation(VIEWPORT)
    points = list(observation.payload["points"])
    broken = observation.model_copy(
        update={"payload": {**observation.payload, "points": ["!!!not-a-point!!!", *points]}}
    )

    assert len(tile_rows(broken)) == 134


def test_a_city_without_a_usable_uid_is_dropped_not_guessed() -> None:
    """`game_uid` is a bigint and the server comes out of the uid. A tile
    whose uid will not parse must not be filed under a made-up server."""
    observation = load_observation(VIEWPORT)
    import base64

    from dw_collector.protocol.worldmap import B64_PREFIX

    def _varint(value: int) -> bytes:
        out = bytearray()
        while True:
            byte = value & 0x7F
            value >>= 7
            out.append(byte | (0x80 if value else 0))
            if not value:
                return bytes(out)

    def _v(number: int, value: int) -> bytes:
        return _varint(number << 3) + _varint(value)

    def _b(number: int, payload: bytes) -> bytes:
        return _varint((number << 3) | 2) + _varint(len(payload)) + payload

    nonsense = _v(1, 1234) + _v(2, 3) + _b(3, _b(1, b"not-a-number"))
    entry = B64_PREFIX + base64.b64encode(nonsense).decode()
    one_bad = observation.model_copy(update={"payload": {"points": [entry]}})

    assert world_map.normalize(one_bad) == []


def test_replay_is_idempotent() -> None:
    observation = load_observation(VIEWPORT)
    first = [r.idempotency_key for r in world_map.normalize(observation)]
    second = [r.idempotency_key for r in world_map.normalize(observation)]

    assert first == second


def test_key_survives_a_parser_version_bump() -> None:
    observation = load_observation(VIEWPORT)
    before = world_map.normalize(observation)[0].idempotency_key

    original = world_map.PARSER_VERSION
    world_map.PARSER_VERSION = "9.9.9"
    try:
        after = world_map.normalize(observation)[0].idempotency_key
    finally:
        world_map.PARSER_VERSION = original

    assert before == after
