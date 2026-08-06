"""get.user.info.multi → player_snapshots rows (public player summaries).

Real payload (S14-PR7, fixture from darkwar_player_profile_cp.pcapng): a
`uids` list of summary cards. Unlike server.rank this response DOES carry
`allianceId`, so it is the one summary source that can populate
`alliance_external_id` without a second lookup.

Two fields deliberately not mapped:

- `rank` reads 0 in every captured response — neither a leaderboard
  position nor an R1-R5 alliance grade — so it stays in `raw` rather than
  becoming a guessed column value.
- `level` is 1 while `mainBuildingLevel` is 35-45; the latter is the HQ
  level the product means.

THREE FIELDS PROMOTED IN 1.1.0, and they are why this parser writes to a second
table. A profile open turns out to carry component figures the ranking boards
only give for the top 150:

- `maxPower` / `maxHeroId` are the strongest hero and which one. VERIFIED, not
  assumed: for the 14 players present in both this command and board type 49,
  maxPower == hero_power_best and maxHeroId == unit_id on 14 of 14. So they are
  written as `hero_power_best` — the SAME metric as the board, because they are
  the same fact observed by another route, and `source_command` already records
  which route. Our own roster went from 8 members with a hero figure to about 50.
- `migratePower` is the migration power, admin-only (0086). Named by the owner;
  before that it sat in `raw` unpromoted because a number nobody can name is
  exactly what this project has three rejected commands for.

These rows carry NO rank and NO board_type. A profile open has no ranking behind
it, and 0086 made `board_type` nullable to say so rather than inventing a board.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.fields import month_card_expires_at
from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.1.0"

_UID_SERVER_SUFFIX = 6


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    power: int | None = None
    main_building_level: int | None = Field(default=None, alias="mainBuildingLevel")
    army_kill: int | None = Field(default=None, alias="armyKill")
    alliance_id: str | None = Field(default=None, alias="allianceId")
    server_id: int | None = Field(default=None, alias="serverId")
    # 1.1.0. The strongest hero and its id, and the migration power.
    max_power: int | None = Field(default=None, alias="maxPower")
    max_hero_id: int | None = Field(default=None, alias="maxHeroId")
    migrate_power: int | None = Field(default=None, alias="migratePower")

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(alias="uids")


@register("get.user.info.multi")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("uids", [])

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
                idempotency_key=idempotency_key(
                    observation, f"get.user.info.multi:{game_uid}", bucket
                ),
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
                    "alliance_external_id": entry.alliance_id,
                    "hq_level": entry.main_building_level,
                    "power": entry.power,
                    "kills": entry.army_kill,
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
        rows.extend(
            _component_rows(
                observation,
                entry,
                raw_entry,
                bucket=bucket,
                game_uid=game_uid,
                server_id=server_id,
            )
        )
    return rows


def _component_rows(
    observation: Observation,
    entry: _Entry,
    raw_entry: dict[str, Any],
    *,
    bucket: str,
    game_uid: int,
    server_id: int,
) -> list[NormalizedRow]:
    """The component figures a profile open carries (1.1.0).

    A SECOND TARGET TABLE from one parser, which is unusual here and deliberate: a
    profile is one response describing one player, and its hero figure belongs with
    the hero figures rather than in a column of `player_snapshots` that would then
    mean something different from `power`.

    Each metric gets its own idempotency key. They hash the same observation, so
    without a distinct discriminator the second row would collide with the first and
    be dropped as a duplicate — the unique index would keep whichever arrived first
    and the other figure would silently never exist.

    A missing field yields no row at all, rather than a row with a null power. "We
    did not observe this" and "this is zero" are different claims, and only one of
    them is true.
    """
    figures: list[tuple[str, int | None, int | None]] = [
        # (metric, power, unit_id)
        ("hero_power_best", entry.max_power, entry.max_hero_id),
        ("migrate_power", entry.migrate_power, None),
    ]
    rows: list[NormalizedRow] = []
    for metric, power, unit_id in figures:
        if power is None:
            continue
        rows.append(
            NormalizedRow(
                target_table="player_component_power_snapshots",
                idempotency_key=idempotency_key(
                    observation, f"get.user.info.multi:{metric}:{game_uid}", bucket
                ),
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
                    "metric": metric,
                    "power": power,
                    # No ranking behind a profile open, and no board it came from.
                    "rank": None,
                    "board_type": None,
                    "name": entry.name,
                    "unit_id": unit_id,
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
