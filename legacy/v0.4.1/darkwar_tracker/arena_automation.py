from __future__ import annotations

import argparse
import datetime as dt
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import sqlite3
import time

from .adb_control import (
    AdbClient,
    AdbError,
    load_tap_sequence,
    resolve_adb_path,
    scaled_tap,
)
from .config import AppConfig, load_config

UTC = dt.timezone.utc


def setup_logging(verbose: bool = False) -> logging.Logger:
    Path("logs").mkdir(exist_ok=True)
    logger = logging.getLogger("darkwar.arena_automation")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s"
    )
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    logger.addHandler(console)

    file_handler = RotatingFileHandler(
        "logs/arena_automation.log",
        maxBytes=5_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    return logger


def target_for_date(
    date_value: dt.date,
    config: AppConfig,
) -> dt.datetime:
    arena = config.arena_automation
    reset = dt.datetime(
        date_value.year,
        date_value.month,
        date_value.day,
        arena.reset_hour_utc,
        arena.reset_minute_utc,
        tzinfo=UTC,
    )
    return reset + dt.timedelta(
        seconds=arena.delay_after_reset_seconds
    )


def next_target_after(
    now: dt.datetime,
    config: AppConfig,
) -> dt.datetime:
    now = now.astimezone(UTC)
    today_target = target_for_date(now.date(), config)
    if now < today_target:
        return today_target
    return target_for_date(now.date() + dt.timedelta(days=1), config)


def _parse_database_time(value: object) -> dt.datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def latest_arena_snapshot(
    database_path: str | Path,
) -> tuple[int, dt.datetime | None]:
    path = Path(database_path)
    if not path.exists():
        return 0, None

    connection = sqlite3.connect(path)
    try:
        row = connection.execute(
            """
            SELECT COALESCE(MAX(snapshot_id), 0), MAX(captured_at)
            FROM arena_snapshots
            """
        ).fetchone()
    except sqlite3.OperationalError:
        return 0, None
    finally:
        connection.close()

    if row is None:
        return 0, None
    return int(row[0] or 0), _parse_database_time(row[1])


def should_catch_up(
    now: dt.datetime,
    latest_snapshot_at: dt.datetime | None,
    config: AppConfig,
) -> bool:
    arena = config.arena_automation
    if not arena.catch_up_after_start:
        return False
    now = now.astimezone(UTC)
    today_target = target_for_date(now.date(), config)
    if now < today_target:
        return False
    return latest_snapshot_at is None or latest_snapshot_at < today_target


class ArenaRefresher:
    def __init__(
        self,
        config: AppConfig,
        logger: logging.Logger,
    ) -> None:
        self.config = config
        self.logger = logger
        arena = config.arena_automation
        adb_path = resolve_adb_path(arena.adb_path)
        self.adb = AdbClient(adb_path, arena.device_serial)

    def refresh_once(self) -> bool:
        arena = self.config.arena_automation
        sequence = load_tap_sequence(arena.sequence_path)
        serial = self.adb.ensure_device()
        self.logger.info("ADB device: %s", serial)

        before_id, _ = latest_arena_snapshot(self.config.database.path)
        started_at = dt.datetime.now(UTC)

        self.logger.info("Launching Dark War for arena refresh")
        self.adb.launch_package(
            arena.package,
            force_stop=arena.force_restart_game,
        )
        time.sleep(arena.launch_wait_seconds)

        current_width, current_height = self.adb.screen_size()
        for index, step in enumerate(sequence.steps, start=1):
            x, y = scaled_tap(
                step,
                sequence,
                current_width,
                current_height,
            )
            self.logger.info(
                "Arena UI step %s/%s: %s at (%s, %s)",
                index,
                len(sequence.steps),
                step.label,
                x,
                y,
            )
            self.adb.tap(x, y)
            wait_seconds = (
                step.wait_seconds
                if step.wait_seconds is not None
                else arena.tap_wait_seconds
            )
            time.sleep(wait_seconds)

        deadline = time.monotonic() + arena.verification_timeout_seconds
        while time.monotonic() < deadline:
            snapshot_id, captured_at = latest_arena_snapshot(
                self.config.database.path
            )
            if snapshot_id > before_id and (
                captured_at is None or captured_at >= started_at
            ):
                self.logger.info(
                    "Arena refresh verified: snapshot_id=%s captured_at=%s",
                    snapshot_id,
                    captured_at.isoformat() if captured_at else "unknown",
                )
                return True
            time.sleep(1.0)

        self.logger.error(
            "Arena screen sequence finished, but no new arena snapshot was "
            "stored within %s seconds. Confirm the collector is running and "
            "recalibrate the tap sequence if the UI changed.",
            arena.verification_timeout_seconds,
        )
        return False

    def refresh_with_retries(self) -> bool:
        arena = self.config.arena_automation
        attempts = (0, *arena.retry_delays_seconds)
        for attempt_number, delay in enumerate(attempts, start=1):
            if delay:
                self.logger.warning(
                    "Retrying arena refresh in %s seconds", delay
                )
                time.sleep(delay)
            try:
                if self.refresh_once():
                    return True
            except (AdbError, OSError, sqlite3.Error):
                self.logger.exception(
                    "Arena refresh attempt %s failed", attempt_number
                )
        self.logger.error("All arena refresh attempts failed")
        return False


def sleep_until(target: dt.datetime, logger: logging.Logger) -> None:
    while True:
        now = dt.datetime.now(UTC)
        remaining = (target - now).total_seconds()
        if remaining <= 0:
            return
        if remaining > 3600:
            logger.info(
                "Next arena refresh: %s UTC (in %.1f hours)",
                target.strftime("%Y-%m-%d %H:%M:%S"),
                remaining / 3600,
            )
        time.sleep(min(remaining, 300))


def run_scheduler(config: AppConfig, logger: logging.Logger) -> int:
    arena = config.arena_automation
    if not arena.enabled:
        logger.error(
            "Arena automation is disabled. Run calibrate_arena.bat or set "
            "arena_automation.enabled = true in config.toml."
        )
        return 2

    refresher = ArenaRefresher(config, logger)
    _, latest = latest_arena_snapshot(config.database.path)
    now = dt.datetime.now(UTC)

    if should_catch_up(now, latest, config):
        logger.info(
            "No arena snapshot exists after today's reset+2-minute target; "
            "running one catch-up refresh now."
        )
        refresher.refresh_with_retries()

    while True:
        target = next_target_after(dt.datetime.now(UTC), config)
        sleep_until(target, logger)
        logger.info(
            "Daily arena refresh triggered at server reset + 2 minutes"
        )
        refresher.refresh_with_retries()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Open and refresh the Dark War arena screen every day at "
            "server reset + 2 minutes."
        )
    )
    parser.add_argument("--config", default="config.toml")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    config = load_config(args.config)
    logger = setup_logging(args.verbose)

    if args.status:
        snapshot_id, captured_at = latest_arena_snapshot(
            config.database.path
        )
        next_target = next_target_after(dt.datetime.now(UTC), config)
        print(f"enabled={config.arena_automation.enabled}")
        print(f"latest_snapshot_id={snapshot_id}")
        print(
            "latest_snapshot_at="
            + (captured_at.isoformat() if captured_at else "none")
        )
        print(f"next_target_utc={next_target.isoformat()}")
        print(
            f"tap_sequence={config.arena_automation.sequence_path.resolve()}"
        )
        return 0

    if args.once:
        try:
            return 0 if ArenaRefresher(config, logger).refresh_with_retries() else 1
        except (AdbError, OSError, sqlite3.Error):
            logger.exception("Arena refresh failed")
            return 1

    try:
        return run_scheduler(config, logger)
    except KeyboardInterrupt:
        logger.info("Arena scheduler stopped")
        return 0
    except (AdbError, OSError, sqlite3.Error):
        logger.exception("Arena scheduler failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
