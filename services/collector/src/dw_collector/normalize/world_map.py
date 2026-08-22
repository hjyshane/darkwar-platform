"""world.get.new → world_city_snapshots.

A viewport of up to 657 tiles, of which only the player cities are written.
`protocol/worldmap.py` holds the wire format and the evidence for each
field; this module is the part that decides what goes in a table.

WHAT IS DROPPED, AND WHY THAT IS THE POINT. Thirteen of the fourteen object
types are not stored. Resources, marches and alliance buildings are
readable but nothing asks for them yet; the eight nobody has opened are not
readable at all. Type 21 is dropped despite looking like a levelled season
building — the refutation is in the protocol module, and writing it here as
a level would put a wrong number in front of the alliance.

The raw payload is journalled either way, so a type promoted later needs no
re-capture: `renormalize` replays the stored observations through whatever
the parsers have become. That is not theoretical here — the season boards
were recovered exactly that way after four days of a stale daemon filing
them as unknown.
"""

from __future__ import annotations

from typing import Any

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.protocol.worldmap import CITY_TYPE, decode_viewport
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

_UID_SERVER_SUFFIX = 6


def _server_from_uid(uid: str) -> int:
    """D-1: the uid's trailing six digits are the player's home server."""
    return int(uid[-_UID_SERVER_SUFFIX:])


@register("world.get.new")
def normalize(observation: Observation) -> list[NormalizedRow]:
    bucket = observation.captured_at.date().isoformat()

    rows: list[NormalizedRow] = []
    for tile in decode_viewport(observation.payload):
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
        raw: dict[str, Any] = dict(tile.raw)
        rows.append(
            NormalizedRow(
                target_table="world_city_snapshots",
                # Scoped by the TILE, not by the player. One viewport can only
                # hold a given coordinate once, and two overlapping pans of the
                # same ground in one day are the same fact — the payload hash
                # in the key is what separates them when the map has moved on.
                idempotency_key=idempotency_key(observation, f"tile:{tile.point_id}", bucket),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw,
                    "server_id": server_id,
                    "game_uid": int(uid),
                    "point_id": tile.point_id,
                    "x": tile.x,
                    "y": tile.y,
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
