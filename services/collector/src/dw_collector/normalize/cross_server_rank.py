"""cross.server.rank → player_snapshots rows (one server's top 150 by power).

The Migration tab's state list: pick a server and the game answers with that
server's 150 strongest players, each `{rank, uid, name, power, lv, abbr,
allianceName, serverId, …}` (first live capture 2026-10-27, 23 servers).
It is the same row shape as `server.rank`, but `rank` here is the place WITHIN
THAT SERVER, and that is what the migration tiers are cut on. `server.rank`'s
`rank` is a place on the group board, so the two must never share the column:
`player_snapshots.rank` is left null here and the place stays in `raw`.

The response names no tier and carries no migrate power. A player outside the
150 is simply absent; that says only that their place is beyond 150.
"""

from __future__ import annotations

from typing import Any

from dw_collector.fields import month_card_expires_at
from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.normalize.server_rank import _Payload
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"
COMMAND = "cross.server.rank"

_UID_SERVER_SUFFIX = 6


@register(COMMAND)
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("serverRanking", [])

    rows: list[NormalizedRow] = []
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        game_uid = int(entry.uid)
        if entry.server_id is not None:
            server_id = entry.server_id
        elif len(entry.uid) > _UID_SERVER_SUFFIX:
            server_id = int(entry.uid[-_UID_SERVER_SUFFIX:])
        else:
            server_id = observation.collected_from_server_id
        rows.append(
            NormalizedRow(
                target_table="player_snapshots",
                idempotency_key=idempotency_key(observation, f"{COMMAND}:{game_uid}", bucket),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_entry,
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "name": entry.name,
                    "alliance_external_id": None,
                    "hq_level": entry.lv,
                    "power": entry.power,
                    "kills": None,
                    "rank": None,
                    "month_card_expires_at": month_card_expires_at(
                        raw_entry.get("monthCardEndTime")
                    ),
                },
                entity_refs={
                    "player": {
                        "game_uid": game_uid,
                        "server_id": server_id,
                        "name": entry.name,
                    },
                },
            )
        )
    return rows
