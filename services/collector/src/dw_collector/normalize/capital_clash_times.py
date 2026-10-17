"""When a Capital Clash starts and ends (0291).

Two commands carry it, and neither needs the screen opened for the clash:

``get.king.info`` -> ``capital_clash_times``
    ``kingInfo.termEndTime`` is the end of the king's term, which is the START
    of the next Capital Clash: the term that began on 2026-10-03 reported
    ``1792245600000`` (2026-10-17 14:00:00 UTC) on 10-08, nine days before the
    battle began at 14:00:04. Two weeks per term (the one after reports
    10-31 14:00). ``finishTime`` is when the LAST battle ended
    (2026-10-17 15:20:04 on the same payload after the fight).
``push.kingdom.fight.finish`` -> ``capital_clash_times``
    ``finishTime`` as the battle ends, with ``occupyAllianceId`` the winner.
    The same instant as ``get.king.info``'s ``finishTime`` afterwards.

A fact is one row: its kind (``start`` or ``finish``) and the instant. Seeing
the same fact again is the same row; seeing a different one is another, and the
window for a game day is read from them in SQL (0291), the latest start and
the first finish after it.

``start`` is the scheduled start, 4 seconds ahead of the first battle tick the
game itself reported (``battleStartTime`` 14:00:04.734 in
``world.get.alliance.city.detail``). That command is NOT used: it describes any
alliance city, and only this one is known to be the capital.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

# The game day turns over at 02:00 UTC (midnight server time, UTC-2).
_DAY_TURNS = timedelta(hours=2)


class _King(BaseModel):
    model_config = ConfigDict(extra="allow")

    term_end_ms: int | None = Field(default=None, alias="termEndTime")


class _KingInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    king: _King | None = Field(default=None, alias="kingInfo")
    finish_ms: int | None = Field(default=None, alias="finishTime")
    occupy_alliance: str | None = Field(default=None, alias="occupyAllianceId")


class _Finish(BaseModel):
    model_config = ConfigDict(extra="allow")

    finish_ms: int = Field(alias="finishTime", gt=0)
    occupy_alliance: str | None = Field(default=None, alias="occupyAllianceId")


def _at(milliseconds: int) -> datetime:
    return datetime.fromtimestamp(milliseconds / 1000, tz=UTC)


def _fact(
    observation: Observation,
    kind: str,
    milliseconds: int,
    raw: dict[str, Any],
    occupy_alliance: str | None,
) -> NormalizedRow:
    at = _at(milliseconds)
    # The key is the raw field, so the same fact seen in any number of
    # observations is one row, and nothing about WHEN it was seen is in it.
    # key_command: one fact reaches us by two commands (the finish push and
    # the king info after it), and both must land on the same key.
    key = entry_idempotency_key(
        observation,
        f"capital_clash_time:{kind}",
        at.isoformat(),
        raw,
        key_command="capital_clash_times",
    )
    return NormalizedRow(
        target_table="capital_clash_times",
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
            "kind": kind,
            "at": at.isoformat(),
            "held_on": (at - _DAY_TURNS).date().isoformat(),
            "occupy_alliance_external_id": occupy_alliance,
        },
        entity_refs={},
    )


@register("get.king.info")
def normalize_king_info(observation: Observation) -> list[NormalizedRow]:
    info = _KingInfo.model_validate(observation.payload)
    rows: list[NormalizedRow] = []
    if info.king is not None and info.king.term_end_ms:
        rows.append(
            _fact(
                observation,
                "start",
                info.king.term_end_ms,
                {"termEndTime": info.king.term_end_ms},
                None,
            )
        )
    if info.finish_ms:
        rows.append(
            _fact(
                observation,
                "finish",
                info.finish_ms,
                {"finishTime": info.finish_ms},
                info.occupy_alliance,
            )
        )
    return rows


@register("push.kingdom.fight.finish")
def normalize_fight_finish(observation: Observation) -> list[NormalizedRow]:
    finish = _Finish.model_validate(observation.payload)
    return [
        _fact(
            observation,
            "finish",
            finish.finish_ms,
            {"finishTime": finish.finish_ms},
            finish.occupy_alliance,
        )
    ]
