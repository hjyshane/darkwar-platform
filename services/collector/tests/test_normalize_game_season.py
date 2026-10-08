"""init.seasonStage — the game's own season calendar.

What this pins: the numbers the live journal showed on 2026-10-08 (stage 2
began 2026-08-17 02:00 UTC and settles 2026-10-05; stage 3 is announced for
2026-11-09), one row per distinct calendar however many logins show it, and
nothing at all when the response does not name a current stage.
"""

from __future__ import annotations

from typing import Any

from dw_collector.normalize import account_state, game_season
from tests.conftest import load_observation

LOGIN = "init/login_v1.json"

AUG_17 = 1_786_932_000_000  # 2026-08-17 02:00 UTC
OCT_05 = 1_791_165_600_000  # 2026-10-05 02:00 UTC
OCT_12 = 1_791_770_400_000
NOV_09 = 1_794_189_600_000  # 2026-11-09 02:00 UTC


def _payload(**extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "seasonStage": {"stage": 2, "startTime": AUG_17},
        "nextSeasonStage": {"stage": 3, "startTime": NOV_09},
        "seasonInfo": {
            "season": 2,
            "seasonId": 6,
            "seasonStartTime": AUG_17,
            "settleTime": OCT_05,
            "endRewardTime": OCT_12,
        },
    }
    return {**base, **extra}


def _rows(payload: dict[str, Any]):
    observation = load_observation(LOGIN)
    return game_season.season_rows(observation.model_copy(update={"payload": payload}))


def test_the_calendar_the_journal_showed() -> None:
    (row,) = _rows(_payload())

    assert row.target_table == "game_season_snapshots"
    assert row.row["stage"] == 2
    assert row.row["starts_at"] == "2026-08-17T02:00:00+00:00"
    assert row.row["settle_at"] == "2026-10-05T02:00:00+00:00"
    assert row.row["end_reward_at"] == "2026-10-12T02:00:00+00:00"
    assert row.row["next_stage"] == 3
    assert row.row["next_starts_at"] == "2026-11-09T02:00:00+00:00"


def test_before_the_next_stage_is_announced() -> None:
    payload = _payload()
    del payload["nextSeasonStage"]
    (row,) = _rows(payload)

    assert row.row["next_stage"] is None
    assert row.row["next_starts_at"] is None


def test_a_stale_season_info_does_not_date_this_season() -> None:
    """`seasonInfo` for another start must not give this stage its settle date."""
    payload = _payload(seasonInfo={"seasonStartTime": AUG_17 - 1, "settleTime": OCT_05})
    (row,) = _rows(payload)

    assert row.row["settle_at"] is None


def test_no_current_stage_is_no_row() -> None:
    assert _rows({}) == []
    assert _rows(_payload(seasonStage={"stage": 2})) == []
    assert _rows(_payload(seasonStage={"stage": "2", "startTime": AUG_17})) == []
    # Not a date the game meant.
    assert _rows(_payload(seasonStage={"stage": 2, "startTime": 5})) == []


def test_a_next_stage_that_does_not_come_later_is_ignored() -> None:
    (row,) = _rows(_payload(nextSeasonStage={"stage": 3, "startTime": AUG_17}))

    assert row.row["next_stage"] is None


def test_same_calendar_same_key_however_often_it_is_seen() -> None:
    (a,) = _rows(_payload())
    (b,) = _rows(_payload())
    (later,) = _rows(_payload(nextSeasonStage={"stage": 3, "startTime": NOV_09 + 3_600_000}))

    assert a.idempotency_key == b.idempotency_key
    assert later.idempotency_key != a.idempotency_key


def test_a_login_without_the_calendar_makes_only_its_usual_rows() -> None:
    tables = [row.target_table for row in account_state.normalize(load_observation(LOGIN))]

    assert "game_season_snapshots" not in tables
