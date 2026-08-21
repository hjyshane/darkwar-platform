"""get.alliance.season.score.rank → alliance_season_score_snapshots.

The season 3 alliance score board. 89 alliances in the observed response,
every field below present in 89/89 rows across both observations
(season_tab_map_building.pcapng, 2026-08-20).

Two things about this board are not like the others:

`oldRank` arrives FROM THE SERVER. It is stored as `previous_rank` rather
than recomputed by diffing the preceding snapshot the way
rank_period_movement does. Spec §14.4's distinction applies — this is
`observed`, not `calculated`, and conflating the two would let a gap in
capture look like a rank that did not move.

The board REACHES OUTSIDE THE TRACKED GROUP. The observed serverIds were
580, 584, 586 and 588, and `servers` is seeded 577-584. Nothing is done
about that here on purpose: the row names its server honestly and sync's
ensure_servers() registers the unknown ones as untracked, which is the
mechanism NFR-007 already put in place for exactly this.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    # The game's 32-hex alliance id, matching alliances.external_id.
    alliance_id: str = Field(alias="allianceId")
    server_id: int = Field(alias="serverId")
    # Note the capital N. The player board for the same season spells the
    # same concept `alliancename`; that inconsistency is the game's.
    alliance_name: str | None = Field(default=None, alias="allianceName")
    abbr: str | None = None
    country: str | None = None
    leader: str | None = None
    score: int | None = None
    power: int | None = None
    rank: int | None = None
    old_rank: int | None = Field(default=None, alias="oldRank")


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(default_factory=list, alias="rankList")


@register("get.alliance.season.score.rank")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("rankList", [])

    rows: list[NormalizedRow] = []
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        rows.append(
            NormalizedRow(
                target_table="alliance_season_score_snapshots",
                idempotency_key=idempotency_key(
                    observation, f"alliance:{entry.alliance_id}", bucket
                ),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_entry,
                    "server_id": entry.server_id,
                    "alliance_external_id": entry.alliance_id,
                    "alliance_name": entry.alliance_name,
                    "alliance_abbr": entry.abbr,
                    "country": entry.country,
                    # A player's name, not an alliance's.
                    "leader_name": entry.leader,
                    "score": entry.score,
                    "power": entry.power,
                    "rank": entry.rank,
                    "previous_rank": entry.old_rank,
                },
                entity_refs={
                    "alliance": {
                        "server_id": entry.server_id,
                        "external_id": entry.alliance_id,
                        "name": entry.alliance_name,
                        "code": entry.abbr,
                    },
                },
            )
        )
    return rows
