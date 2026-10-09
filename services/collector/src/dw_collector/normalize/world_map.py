"""world.get.new → world_viewport_snapshots + world_city_snapshots
+ season_building_snapshots.

A viewport of up to 657 tiles, of which only the player cities are written.
`protocol/worldmap.py` holds the wire format and the evidence for each
field; this module is the part that decides what goes in a table.

Two types are stored: player cities (3) and members' SEASON BUILDINGS (6).
The second is what the alliance actually asked for, and this module had it
labelled "marches" until 22 buildings were clicked one at a time and every
one came back as type 6.

Type 21 was dropped here for a long time because it looks like a levelled
season building and three tests refuted that. It is the hero DISPATCH MISSION
(0254): f101.f2 is a key of aps_dispatch_tasks in 65,190 of 65,190 sightings,
f101.f5/f6 are start and finish in epoch milliseconds, and they exist only once
the mission has been started. Only started ones are written - an unstarted one
cannot be plundered and would otherwise be most of the rows.

WHAT IS STILL DROPPED, AND WHY THAT IS THE POINT. Resources and alliance
buildings are readable but nothing asks for them yet; the types nobody has
opened are not readable at all.

The raw payload is journalled either way, so a type promoted later needs no
re-capture: `renormalize` replays the stored observations through whatever
the parsers have become. That is not theoretical here — the season boards
were recovered exactly that way after four days of a stale daemon filing
them as unknown.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, idempotency_key
from dw_collector.protocol.worldmap import (
    CITY_TYPE,
    DISPATCH_MISSION_TYPE,
    SEASON_BUILDING_TYPE,
    Tile,
    decode_viewport,
)
from dw_collector.registry import register

# 1.1.0: the coordinate unpacking was wrong in two ways at once - the two
# halves of point_id were swapped, and the column half is one-based. Rows
# written before this carry each other's axes; 0142 repairs them in place from
# point_id, which is stored raw for exactly this reason.
# 1.2.0: emits a world_viewport_snapshots row per response, so coverage can be
# asked of the map. `renormalize` backfills it from journalled observations.
# 1.3.0: started dispatch missions (type 21) go to dispatch_mission_snapshots.
# 1.4.0: a city row carries when its shield ends (0261).
PARSER_VERSION = "1.4.0"

_UID_SERVER_SUFFIX = 6


def _server_from_uid(uid: str) -> int:
    """D-1: the uid's trailing six digits are the player's home server."""
    return int(uid[-_UID_SERVER_SUFFIX:])


def _common(observation: Observation, tile: Tile, server_id: int) -> dict[str, Any]:
    return {
        "observation_id": str(observation.observation_id),
        "source_command": observation.source_command,
        "parser_version": PARSER_VERSION,
        "captured_at": observation.captured_at.isoformat(),
        "collector_id": str(observation.collector_id),
        "collected_from_server_id": observation.collected_from_server_id,
        "raw": dict(tile.raw),
        "server_id": server_id,
        "point_id": tile.point_id,
        "x": tile.x,
        "y": tile.y,
    }


def _shield_end(seconds: int | None) -> str | None:
    if seconds is None or seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, UTC).isoformat()


def _usable_uid(uid: str | None) -> bool:
    """The uid becomes a bigint and the server is decoded from it, so a uid
    that will not parse is a decode nobody understands — filing it anyway
    would put somebody's building under a made-up server."""
    return uid is not None and uid.isdigit() and len(uid) > _UID_SERVER_SUFFIX


def _mission_row(observation: Observation, tile: Tile, bucket: str) -> NormalizedRow | None:
    """A started, plunderable dispatch mission; None for anything else."""
    mission = tile.mission
    if mission is None or tile.object_type != DISPATCH_MISSION_TYPE:
        return None
    if mission.uuid is None or mission.mission_id is None:
        return None
    if mission.started_ms is None or mission.finish_ms is None:
        return None
    uid = mission.owner_uid
    owner: int | None = None
    server_id = tile.server_id
    if uid is not None and _usable_uid(uid):
        owner = int(uid)
        server_id = _server_from_uid(uid)
    if server_id is None:
        return None
    return NormalizedRow(
        target_table="dispatch_mission_snapshots",
        # Scoped by the MISSION and hashed over its own tile, so the same state
        # seen from overlapping viewports is one row, not one per pan.
        idempotency_key=entry_idempotency_key(
            observation, f"mission:{mission.uuid}", bucket, tile.raw
        ),
        row={
            **_common(observation, tile, server_id),
            "mission_id": mission.mission_id,
            "mission_uuid": str(mission.uuid),
            "owner_game_uid": owner,
            "alliance_external_id": mission.alliance_id,
            "started_at": datetime.fromtimestamp(mission.started_ms / 1000, UTC).isoformat(),
            "ends_at": datetime.fromtimestamp(mission.finish_ms / 1000, UTC).isoformat(),
        },
    )


def _viewport_row(observation: Observation, tiles: list[Tile], bucket: str) -> NormalizedRow | None:
    """Where the camera looked, which the city rows cannot say.

    A viewport writes a row per CITY, so ground with nobody on it writes
    nothing and "no rows here" means either "never swept" or "swept, empty".
    A sweeper cannot tell those apart, so it would re-walk the empty half of
    the map forever. This row is the difference.

    Everything needed is in the response itself — it echoes `x`, `y`,
    `viewLvl` and `serverId` — so this needs no correlation with the request
    and `renormalize` reconstructs the whole coverage history from
    observations already journalled.
    """
    payload = observation.payload
    center_x, center_y = payload.get("x"), payload.get("y")
    server_id = payload.get("serverId")
    if not isinstance(center_x, int) or not isinstance(center_y, int):
        return None
    if not isinstance(server_id, int):
        return None

    xs = [tile.x for tile in tiles]
    ys = [tile.y for tile in tiles]
    view_lvl = payload.get("viewLvl")
    return NormalizedRow(
        target_table="world_viewport_snapshots",
        idempotency_key=idempotency_key(observation, "viewport", bucket),
        row={
            "observation_id": str(observation.observation_id),
            "source_command": observation.source_command,
            "parser_version": PARSER_VERSION,
            "captured_at": observation.captured_at.isoformat(),
            "collector_id": str(observation.collector_id),
            "collected_from_server_id": observation.collected_from_server_id,
            "raw": {},
            # The MAP's server, from the response's own field. Unlike a city,
            # whose server comes from its uid, the ground being looked at
            # belongs to exactly one server and the response names it.
            "server_id": server_id,
            "center_x": center_x,
            "center_y": center_y,
            "view_lvl": view_lvl if isinstance(view_lvl, int) else None,
            # The box the OBJECTS fell in, not the box the camera saw:
            # `points` carries objects only, so over empty ground this is much
            # smaller than the window. Stored so the coverage view's assumed
            # half-extents can be audited rather than trusted.
            "object_count": len(tiles),
            "min_x": min(xs) if xs else None,
            "max_x": max(xs) if xs else None,
            "min_y": min(ys) if ys else None,
            "max_y": max(ys) if ys else None,
        },
    )


@register("world.get.new")
def normalize(observation: Observation) -> list[NormalizedRow]:
    bucket = observation.captured_at.date().isoformat()

    tiles = decode_viewport(observation.payload)
    rows: list[NormalizedRow] = []
    viewport = _viewport_row(observation, tiles, bucket)
    if viewport is not None:
        rows.append(viewport)
    for tile in tiles:
        mission_row = _mission_row(observation, tile, bucket)
        if mission_row is not None:
            rows.append(mission_row)
            continue
        building = tile.building
        if tile.object_type == SEASON_BUILDING_TYPE and building is not None:
            uid = building.owner_uid
            if not _usable_uid(uid):
                continue
            assert uid is not None
            server_id = _server_from_uid(uid)
            rows.append(
                NormalizedRow(
                    target_table="season_building_snapshots",
                    # Scoped by the BUILDING, not the tile: a coordinate can be
                    # rebuilt on, and one object's levelling is the history
                    # worth keeping distinct.
                    idempotency_key=idempotency_key(
                        observation, f"building:{building.object_id or tile.point_id}", bucket
                    ),
                    row={
                        **_common(observation, tile, server_id),
                        "game_uid": int(uid),
                        "object_id": building.object_id,
                        "building_type_id": building.type_id,
                        "level": building.level,
                    },
                    entity_refs={
                        "player": {"game_uid": int(uid), "server_id": server_id},
                    },
                )
            )
            continue

        city = tile.city
        if tile.object_type != CITY_TYPE or city is None:
            continue
        # The uid has to be numeric: it becomes `game_uid`, a bigint, and it
        # is what the server is decoded from. A tile whose uid will not parse
        # is a decode nobody understands, and guessing a server for it would
        # file somebody's city under the wrong one.
        uid = city.uid
        if uid is None or not uid.isdigit() or len(uid) <= _UID_SERVER_SUFFIX:
            continue
        server_id = _server_from_uid(uid)
        rows.append(
            NormalizedRow(
                target_table="world_city_snapshots",
                # Scoped by the TILE, not by the player. One viewport can only
                # hold a given coordinate once, and two overlapping pans of the
                # same ground in one day are the same fact — the payload hash
                # in the key is what separates them when the map has moved on.
                idempotency_key=idempotency_key(observation, f"tile:{tile.point_id}", bucket),
                row={
                    **_common(observation, tile, server_id),
                    "game_uid": int(uid),
                    "name": city.name,
                    "hq_level": city.hq_level,
                    # Epoch SECONDS; in the past once the shield is down, absent when
                    # the base was never shielded. 144 of 8,345 tiles in a day's
                    # captures were in the future, 2-2.5 hours ahead.
                    "shield_end_at": _shield_end(city.shield_end),
                },
                entity_refs={
                    "player": {
                        "game_uid": int(uid),
                        "server_id": server_id,
                        "name": city.name,
                    },
                },
            )
        )
    return rows
