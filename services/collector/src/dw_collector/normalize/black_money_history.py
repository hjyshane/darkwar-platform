"""dragon.battle.history → black_money_battle_snapshots.

One entry per team per Black Money event, reaching back to 2026-04-19 —
25 battles in the first response captured. The team-level result: both
scores, how many entered on each side, and the outcome.

The team `score` is the battle's own points, NOT the sum of the players'
scores in the battle report: team B's 382,529 today against 4,978,293
summed over its 21 players. The two are different measures and must not
be compared.

Read against the screen and against itself:

- `battleTime` is the battle's END. Today's team B entry is 12:50 UTC, the
  `endTime` get.dragon.battle.times gave for period 2.
- `state` 2 is a win and 3 a loss: in every entry of the captured response,
  state 2 is exactly the entries where `score` beats `enemyScore`.
- `userNum` is how many of ours ENTERED, against `maxUserNum` 20 starters —
  21 today, so a substitute went in. This is the team's actual turnout.

Two traps in the payload:

- `enemyAllianceId` is OUR alliance's id on every entry that carries it
  (24 of 25). It is not the
  opponent and is never stored as one; the opponent is known here only by
  name and tag. The battle report mail carries the opponent's real id.
- One entry (2026-05-03 12:50) has the enemy's score and turnout but no
  enemy name, tag or id. Kept with those two null rather than dropped: the
  rest of it is still a fact.

No server field. The server the capture was labelled with is only a guess:
capture is machine-wide and ingest stamps every file with one server, so a
history opened by ACE's scanner on 578 arrives labelled 580. The alliance
ref says so (`server_id_is_fallback`), and sync puts the row on the server
of the alliance that id already names, if Supabase knows one — the label is
used only for an alliance never seen anywhere else.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.1.0"


class _Battle(BaseModel):
    model_config = ConfigDict(extra="allow")

    alliance_id: str = Field(alias="allianceId")
    name: str | None = None
    abbr: str | None = None
    battle_time: int = Field(alias="battleTime")
    team_index: int = Field(alias="teamIndex")
    side: int | None = None
    state: int | None = None
    score: int | None = None
    user_num: int | None = Field(default=None, alias="userNum")
    max_user_num: int | None = Field(default=None, alias="maxUserNum")
    enemy_name: str | None = Field(default=None, alias="enemyName")
    enemy_abbr: str | None = Field(default=None, alias="enemyAbbr")
    enemy_score: int | None = Field(default=None, alias="enemyScore")
    enemy_user_num: int | None = Field(default=None, alias="enemyUserNum")
    enemy_team_index: int | None = Field(default=None, alias="enemyTeamIndex")


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    battles: list[_Battle] = Field(alias="historyArr")


@register("dragon.battle.history")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    raw_battles: list[dict[str, Any]] = observation.payload.get("historyArr", [])
    server_id = observation.collected_from_server_id

    rows: list[NormalizedRow] = []
    for battle, raw in zip(payload.battles, raw_battles, strict=True):
        ended_at = datetime.fromtimestamp(battle.battle_time / 1000, tz=UTC)
        # A finished battle repeats unchanged in every response, so the key
        # is the battle's own entry, not the envelope around it.
        key = entry_idempotency_key(
            observation,
            f"battle:{battle.alliance_id}:{battle.team_index}",
            ended_at.isoformat(),
            raw,
        )
        rows.append(
            NormalizedRow(
                target_table="black_money_battle_snapshots",
                idempotency_key=key,
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw,
                    "snapshot_id": str(stable_uuid(key)),
                    "server_id": server_id,
                    "alliance_external_id": battle.alliance_id,
                    "battle_ended_at": ended_at.isoformat(),
                    "team_index": battle.team_index,
                    "side": battle.side,
                    "state": battle.state,
                    "score": battle.score,
                    "user_num": battle.user_num,
                    "max_user_num": battle.max_user_num,
                    "enemy_name": battle.enemy_name,
                    "enemy_abbr": battle.enemy_abbr,
                    "enemy_score": battle.enemy_score,
                    "enemy_user_num": battle.enemy_user_num,
                    "enemy_team_index": battle.enemy_team_index,
                },
                entity_refs={
                    "alliance": {
                        "server_id": server_id,
                        "external_id": battle.alliance_id,
                        "name": battle.name,
                        "code": battle.abbr,
                        "server_id_is_fallback": True,
                    },
                },
            )
        )
    return rows
