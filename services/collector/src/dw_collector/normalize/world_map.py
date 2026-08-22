"""world.get.new → world_city_snapshots + season_building_snapshots.

A viewport of up to 657 tiles, of which only the player cities are written.
`protocol/worldmap.py` holds the wire format and the evidence for each
field; this module is the part that decides what goes in a table.

Two types are stored: player cities (3) and members' SEASON BUILDINGS (6).
The second is what the alliance actually asked for, and this module had it
labelled "marches" until 22 buildings were clicked one at a time and every
one came back as type 6.

WHAT IS STILL DROPPED, AND WHY THAT IS THE POINT. Resources and alliance
buildings are readable but nothing asks for them yet; the eight types nobody
has opened are not readable at all. Type 21 is dropped despite looking like
a levelled season building — three tests refute it, and writing it here as a
level would put a wrong number in front of the alliance.

The raw payload is journalled either way, so a type promoted later needs no
re-capture: `renormalize` replays the stored observations through whatever
the parsers have become. That is not theoretical here — the season boards
were recovered exactly that way after four days of a stale daemon filing
them as unknown.
"""

from __future__ import annotations

from typing import Any

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.protocol.worldmap import (
    CITY_TYPE,
    SEASON_BUILDING_TYPE,
    Tile,
    decode_viewport,
)
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

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


def _usable_uid(uid: str | None) -> bool:
    """The uid becomes a bigint and the server is decoded from it, so a uid
    that will not parse is a decode nobody understands — filing it anyway
    would put somebody's building under a made-up server."""
    return uid is not None and uid.isdigit() and len(uid) > _UID_SERVER_SUFFIX


@register("world.get.new")
def normalize(observation: Observation) -> list[NormalizedRow]:
    bucket = observation.captured_at.date().isoformat()

    rows: list[NormalizedRow] = []
    for tile in decode_viewport(observation.payload):
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
