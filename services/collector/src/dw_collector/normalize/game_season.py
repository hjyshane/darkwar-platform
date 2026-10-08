"""init.seasonStage / nextSeasonStage / seasonInfo → game_season_snapshots.

The login response carries the game's own season calendar, which is how the
dashboard learns a season has started without anybody typing the date:

  seasonStage      {stage, startTime}   the season running now
  nextSeasonStage  {stage, startTime}   the one after it, present from some
                                        weeks before it starts
  seasonInfo       {settleTime, endRewardTime, ...}  when this one is settled
                                        and its rewards close

Times are epoch ms. Verified on the live journal (2026-10-08): stage 1 began
2026-05-25 02:00 UTC, stage 2 on 2026-08-17 02:00 (the date the dashboard has
always called Season 3's start), `nextSeasonStage` named stage 3 for
2026-11-09 02:00 from 2026-09-28 on. The game's stage is one below the number
the alliance uses (stage 2 is "Season 3"); the database applies that offset,
not this parser, so what is stored here is what the game said.

It is the same calendar for every account, so there is no per-player part to
strip. One row per distinct calendar (the key hashes the cleaned block): a
handful of rows over a whole year, however many logins there are.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid

PARSER_VERSION = "1.0.0"
KEY_COMMAND = "init.season"

# 2020-01-01 .. 2100-01-01 in epoch ms: a number outside this is not a date
# the game meant, and a bad one must not reach a table that dates the season.
_MIN_MS = 1_577_836_800_000
_MAX_MS = 4_102_444_800_000


def _ms(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if _MIN_MS <= value <= _MAX_MS else None


def _stage(block: Any) -> tuple[int, int] | None:
    """(stage, start ms) of a `{stage, startTime}` block, or None."""
    if not isinstance(block, dict):
        return None
    stage, start = block.get("stage"), _ms(block.get("startTime"))
    if isinstance(stage, bool) or not isinstance(stage, int) or stage < 0 or start is None:
        return None
    return stage, start


def season_calendar(payload: dict[str, Any]) -> dict[str, int | None] | None:
    """The cleaned calendar, or None when the response names no current stage.

    `settle_ms` and `end_reward_ms` come from `seasonInfo` only while it is
    the same stage and start as `seasonStage`; a stale block must not date
    another season."""
    current = _stage(payload.get("seasonStage"))
    if current is None:
        return None
    upcoming = _stage(payload.get("nextSeasonStage"))
    info = payload.get("seasonInfo")
    settle = end_reward = None
    if isinstance(info, dict) and _ms(info.get("seasonStartTime")) == current[1]:
        settle, end_reward = _ms(info.get("settleTime")), _ms(info.get("endRewardTime"))
    return {
        "stage": current[0],
        "start_ms": current[1],
        "next_stage": upcoming[0] if upcoming and upcoming[1] > current[1] else None,
        "next_start_ms": upcoming[1] if upcoming and upcoming[1] > current[1] else None,
        "settle_ms": settle,
        "end_reward_ms": end_reward,
    }


def _at(ms: int | None) -> str | None:
    return None if ms is None else datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat()


def season_rows(observation: Observation) -> list[NormalizedRow]:
    calendar = season_calendar(observation.payload)
    if calendar is None:
        return []
    key = entry_idempotency_key(
        observation, "season", "-", {"calendar": calendar}, key_command=KEY_COMMAND
    )
    return [
        NormalizedRow(
            target_table="game_season_snapshots",
            idempotency_key=key,
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": observation.captured_at.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": {"calendar": calendar},
                "snapshot_id": str(stable_uuid(key)),
                "stage": calendar["stage"],
                "starts_at": _at(calendar["start_ms"]),
                "next_stage": calendar["next_stage"],
                "next_starts_at": _at(calendar["next_start_ms"]),
                "settle_at": _at(calendar["settle_ms"]),
                "end_reward_at": _at(calendar["end_reward_ms"]),
            },
        )
    ]
