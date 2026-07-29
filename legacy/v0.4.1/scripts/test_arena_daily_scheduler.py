from __future__ import annotations

import datetime as dt
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from darkwar_tracker.adb_control import TapSequence, TapStep, scaled_tap
from darkwar_tracker.arena_automation import (
    next_target_after,
    should_catch_up,
    target_for_date,
)
from darkwar_tracker.config import (
    ActivityConfig,
    AppConfig,
    ArenaAutomationConfig,
    CaptureConfig,
    DatabaseConfig,
    TrackingConfig,
)

UTC = dt.timezone.utc


def make_config() -> AppConfig:
    return AppConfig(
        capture=CaptureConfig(None, 8680, None),
        database=DatabaseConfig(Path("data/test.sqlite3")),
        tracking=TrackingConfig((580,), 3),
        activity=ActivityConfig("CBFW", 30, 3, 7, 7),
        arena_automation=ArenaAutomationConfig(
            enabled=True,
            adb_path=None,
            device_serial=None,
            package="com.readygo.dark.gp",
            force_restart_game=True,
            sequence_path=Path("data/arena_taps.json"),
            reset_hour_utc=2,
            reset_minute_utc=0,
            delay_after_reset_seconds=120,
            launch_wait_seconds=20,
            tap_wait_seconds=3,
            verification_timeout_seconds=45,
            retry_delays_seconds=(60, 180, 600),
            catch_up_after_start=True,
        ),
    )


def main() -> int:
    config = make_config()

    target = target_for_date(dt.date(2026, 7, 27), config)
    assert target == dt.datetime(2026, 7, 27, 2, 2, tzinfo=UTC)

    before = dt.datetime(2026, 7, 27, 1, 55, tzinfo=UTC)
    assert next_target_after(before, config) == target

    after = dt.datetime(2026, 7, 27, 2, 3, tzinfo=UTC)
    assert next_target_after(after, config) == dt.datetime(
        2026, 7, 28, 2, 2, tzinfo=UTC
    )

    assert should_catch_up(after, None, config)
    assert should_catch_up(
        after,
        dt.datetime(2026, 7, 27, 2, 1, tzinfo=UTC),
        config,
    )
    assert not should_catch_up(
        after,
        dt.datetime(2026, 7, 27, 2, 2, 30, tzinfo=UTC),
        config,
    )

    sequence = TapSequence(
        version=1,
        recorded_width=1920,
        recorded_height=1080,
        steps=(TapStep("Arena", 960, 540),),
    )
    assert scaled_tap(sequence.steps[0], sequence, 1280, 720) == (640, 360)

    print("arena daily scheduler regression test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
