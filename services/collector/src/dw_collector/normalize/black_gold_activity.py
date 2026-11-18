"""dragon.activity.info → black_money_battle_snapshots.

The same team results dragon.battle.history gives, from the response the
game sends on EVERY login and every open of the event — so an event's
results land without anybody having to open the history screen. On
2026-09-27 team A's result arrived only this way: nobody opened the history
after its battle.

Real payload (journal, 2026-09-14 .. 09-27): `teamArr` holds one entry per
team of the CURRENT event —

  teamIndex    1 = A, 2 = B (as dragon.assign.player.info and the history)
  timeInfo     prepTime, battleOpenTime, endTime — endTime is the history's
               battleTime, to the millisecond
  vsInfoArr    both alliances: allianceId, name, abbr, serverId, side, and
               mainNum 20 (the starter cap — the history's maxUserNum)
  resultInfo   ONLY once the battle is over: per alliance, score, userNum
               and result, 1 for the winner and 2 for the loser

An entry without resultInfo is a battle not yet fought and writes nothing.

`result` is mapped onto the history's `state` (1 → 2 win, 2 → 3 loss), so
the two sources say the same thing in the same column and a reader of the
table does not need to know which one a row came from. Checked against the
09-27 team B entry, which both commands carry: score 382,529 v 284,451,
userNum 21 v 22, won — identical in both.

WHICH ALLIANCE IS OURS. The payload never says. Ours is the alliance that
appears in every team's matchup — each team fights a different opponent,
so the only alliance in both is the one fielding them. With fewer than two
teams that cannot be told, and nothing is written rather than guessing.

Unlike the history, this names the opponent by its REAL alliance id; the
history's enemyAllianceId repeats our own (0178). It is kept in `raw`.

WHOSE SERVER. Our side's own `serverId`, not the server the capture was
labelled with. Capture is machine-wide and ingest stamps every file with one
server (580 by default), so ACE's scanner on 578 logging in wrote ACE's
results as 580's — and, since alliances are keyed by (server, id), under a
second ACE that exists only on 580. The label is the fallback for a side
that carries no serverId.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.normalize.alliance_event_times import black_gold_rows
from dw_collector.registry import register

PARSER_VERSION = "1.1.0"
# dragon.activity.info's `result` → the history's `state`.
STATE_FROM_RESULT = {1: 2, 2: 3}


class _Side(BaseModel):
    model_config = ConfigDict(extra="allow")

    alliance_id: str = Field(alias="allianceId")
    name: str | None = None
    abbr: str | None = None
    server_id: int | None = Field(default=None, alias="serverId")
    side: int | None = None
    main_num: int | None = Field(default=None, alias="mainNum")


class _Result(BaseModel):
    model_config = ConfigDict(extra="allow")

    alliance_id: str = Field(alias="allianceId")
    result: int | None = None
    score: int | None = None
    user_num: int | None = Field(default=None, alias="userNum")


class _Time(BaseModel):
    model_config = ConfigDict(extra="allow")

    end_time: int = Field(alias="endTime")


class _Team(BaseModel):
    model_config = ConfigDict(extra="allow")

    team_index: int = Field(alias="teamIndex")
    time_info: _Time = Field(alias="timeInfo")
    sides: list[_Side] = Field(alias="vsInfoArr")
    results: list[_Result] | None = Field(default=None, alias="resultInfo")


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    teams: list[_Team] = Field(default_factory=list, alias="teamArr")


def our_alliance(teams: list[_Team]) -> str | None:
    """The one alliance in every team's matchup, or None if that is not one.

    A side with no alliance id is an opponent the game has not drawn yet (the
    response sent before the match-up, 2026-10-08, names only ours and `""` in both
    teams): `""` would otherwise be a second alliance common to every team."""
    if len(teams) < 2:
        return None
    common = set.intersection(*({s.alliance_id for s in t.sides if s.alliance_id} for t in teams))
    return next(iter(common)) if len(common) == 1 else None


@register("dragon.activity.info")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    raw_teams: list[dict[str, Any]] = observation.payload.get("teamArr", [])
    ours = our_alliance(payload.teams)
    if ours is None:
        return []

    rows: list[NormalizedRow] = []
    # When the alliance fights is in the same response, before anyone has: the
    # schedule rows (alliance_event_times) are written whatever the results are.
    first_us = next((s for t in payload.teams for s in t.sides if s.alliance_id == ours), None)
    if first_us is not None:
        rows.extend(
            black_gold_rows(
                observation,
                raw_teams,
                {
                    "server_id": first_us.server_id
                    if first_us.server_id is not None
                    else observation.collected_from_server_id,
                    "external_id": ours,
                    "name": first_us.name,
                    "code": first_us.abbr,
                },
            )
        )
    for team, raw in zip(payload.teams, raw_teams, strict=True):
        if not team.results:
            continue
        us = next((s for s in team.sides if s.alliance_id == ours), None)
        them = next((s for s in team.sides if s.alliance_id != ours), None)
        our_result = next((r for r in team.results if r.alliance_id == ours), None)
        their_result = next((r for r in team.results if r.alliance_id != ours), None)
        if us is None or our_result is None:
            continue
        server_id = (
            us.server_id if us.server_id is not None else observation.collected_from_server_id
        )
        ended_at = datetime.fromtimestamp(team.time_info.end_time / 1000, tz=UTC)
        key = entry_idempotency_key(
            observation, f"battle:{ours}:{team.team_index}", ended_at.isoformat(), raw
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
                    "alliance_external_id": ours,
                    "battle_ended_at": ended_at.isoformat(),
                    "team_index": team.team_index,
                    "side": us.side,
                    "state": STATE_FROM_RESULT.get(our_result.result or 0),
                    "score": our_result.score,
                    "user_num": our_result.user_num,
                    "max_user_num": us.main_num,
                    "enemy_name": them.name if them else None,
                    "enemy_abbr": them.abbr if them else None,
                    "enemy_score": their_result.score if their_result else None,
                    "enemy_user_num": their_result.user_num if their_result else None,
                    # The history's enemyTeamIndex has no counterpart here.
                    "enemy_team_index": None,
                },
                entity_refs={
                    "alliance": {
                        "server_id": server_id,
                        "external_id": ours,
                        "name": us.name,
                        "code": us.abbr,
                    },
                },
            )
        )
    return rows
