from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class CaptureConfig:
    interface: str | None
    port: int
    server_ip: str | None


@dataclass(frozen=True)
class DatabaseConfig:
    path: Path


@dataclass(frozen=True)
class TrackingConfig:
    servers: tuple[int, ...]
    top_n: int


@dataclass(frozen=True)
class ActivityConfig:
    own_alliance_code: str | None
    auto_refresh_seconds: int
    inactive_warning_days: int
    inactive_critical_days: int
    pass_expiry_warning_days: int


@dataclass(frozen=True)
class ArenaAutomationConfig:
    enabled: bool
    adb_path: str | None
    device_serial: str | None
    package: str
    force_restart_game: bool
    sequence_path: Path
    reset_hour_utc: int
    reset_minute_utc: int
    delay_after_reset_seconds: int
    launch_wait_seconds: float
    tap_wait_seconds: float
    verification_timeout_seconds: int
    retry_delays_seconds: tuple[int, ...]
    catch_up_after_start: bool




@dataclass(frozen=True)
class RefreshAutomationConfig:
    enabled: bool
    weekly_enabled: bool
    weekly_weekday_utc: int
    reset_hour_utc: int
    reset_minute_utc: int
    weekly_delay_seconds: int
    idle_seconds_required: int
    poll_seconds: int
    interrupt_check_seconds: float
    adb_path: str | None
    device_serial: str | None
    package: str
    sequence_dir: Path
    launch_wait_seconds: float
    tap_wait_seconds: float
    verification_timeout_seconds: int
    max_attempts: int
    catch_up_weekly: bool



@dataclass(frozen=True)
class DiscordActivityConfig:
    enabled: bool
    host: str
    port: int
    viewer_user_ids: tuple[str, ...]
    admin_user_ids: tuple[str, ...]
    timezone: str
    max_rows: int
    allow_dev_bypass: bool


@dataclass(frozen=True)
class AppConfig:
    capture: CaptureConfig
    database: DatabaseConfig
    tracking: TrackingConfig
    activity: ActivityConfig
    arena_automation: ArenaAutomationConfig
    refresh_automation: RefreshAutomationConfig = field(
        default_factory=lambda: RefreshAutomationConfig(
            enabled=False,
            weekly_enabled=True,
            weekly_weekday_utc=0,
            reset_hour_utc=2,
            reset_minute_utc=0,
            weekly_delay_seconds=300,
            idle_seconds_required=300,
            poll_seconds=30,
            interrupt_check_seconds=1.0,
            adb_path=None,
            device_serial=None,
            package="com.readygo.dark.gp",
            sequence_dir=Path("data/refresh_sequences"),
            launch_wait_seconds=25.0,
            tap_wait_seconds=3.0,
            verification_timeout_seconds=75,
            max_attempts=3,
            catch_up_weekly=True,
        )
    )
    discord_activity: DiscordActivityConfig = field(
        default_factory=lambda: DiscordActivityConfig(
            enabled=False,
            host="127.0.0.1",
            port=8765,
            viewer_user_ids=(),
            admin_user_ids=(),
            timezone="America/New_York",
            max_rows=200,
            allow_dev_bypass=False,
        )
    )



def _optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def load_config(path: str | Path = "config.toml") -> AppConfig:
    config_path = Path(path)
    with config_path.open("rb") as handle:
        raw = tomllib.load(handle)

    capture = raw.get("capture", {})
    database = raw.get("database", {})
    tracking = raw.get("tracking", {})
    activity = raw.get("activity", {})
    arena = raw.get("arena_automation", {})
    refresh = raw.get("refresh_automation", {})
    discord_activity = raw.get("discord_activity", {})

    interface = _optional_text(capture.get("interface"))
    server_ip = _optional_text(capture.get("server_ip"))
    own_alliance_code = _optional_text(activity.get("own_alliance_code"))

    reset_hour_utc = int(arena.get("reset_hour_utc", 2))
    reset_minute_utc = int(arena.get("reset_minute_utc", 0))
    if not 0 <= reset_hour_utc <= 23:
        raise ValueError("arena_automation.reset_hour_utc must be 0-23")
    if not 0 <= reset_minute_utc <= 59:
        raise ValueError("arena_automation.reset_minute_utc must be 0-59")

    refresh_weekday = int(refresh.get("weekly_weekday_utc", 0))
    refresh_reset_hour = int(refresh.get("reset_hour_utc", 2))
    refresh_reset_minute = int(refresh.get("reset_minute_utc", 0))
    if not 0 <= refresh_weekday <= 6:
        raise ValueError("refresh_automation.weekly_weekday_utc must be 0-6")
    if not 0 <= refresh_reset_hour <= 23:
        raise ValueError("refresh_automation.reset_hour_utc must be 0-23")
    if not 0 <= refresh_reset_minute <= 59:
        raise ValueError("refresh_automation.reset_minute_utc must be 0-59")

    retry_values = arena.get("retry_delays_seconds", [60, 180, 600])
    retry_delays = tuple(max(0, int(value)) for value in retry_values)

    return AppConfig(
        capture=CaptureConfig(
            interface=interface,
            port=int(capture.get("port", 8680)),
            server_ip=server_ip,
        ),
        database=DatabaseConfig(
            path=Path(database.get("path", "data/darkwar.sqlite3")),
        ),
        tracking=TrackingConfig(
            servers=tuple(
                int(value)
                for value in tracking.get("servers", range(577, 585))
            ),
            top_n=int(tracking.get("top_n", 3)),
        ),
        activity=ActivityConfig(
            own_alliance_code=own_alliance_code,
            auto_refresh_seconds=max(
                0, int(activity.get("auto_refresh_seconds", 30))
            ),
            inactive_warning_days=max(
                1, int(activity.get("inactive_warning_days", 3))
            ),
            inactive_critical_days=max(
                1, int(activity.get("inactive_critical_days", 7))
            ),
            pass_expiry_warning_days=max(
                1, int(activity.get("pass_expiry_warning_days", 7))
            ),
        ),
        arena_automation=ArenaAutomationConfig(
            enabled=bool(arena.get("enabled", False)),
            adb_path=_optional_text(arena.get("adb_path")),
            device_serial=_optional_text(arena.get("device_serial")),
            package=str(arena.get("package", "com.readygo.dark.gp")),
            force_restart_game=bool(arena.get("force_restart_game", True)),
            sequence_path=Path(
                arena.get("sequence_path", "data/arena_taps.json")
            ),
            reset_hour_utc=reset_hour_utc,
            reset_minute_utc=reset_minute_utc,
            delay_after_reset_seconds=max(
                0, int(arena.get("delay_after_reset_seconds", 120))
            ),
            launch_wait_seconds=max(
                0.0, float(arena.get("launch_wait_seconds", 20.0))
            ),
            tap_wait_seconds=max(
                0.0, float(arena.get("tap_wait_seconds", 3.0))
            ),
            verification_timeout_seconds=max(
                1, int(arena.get("verification_timeout_seconds", 45))
            ),
            retry_delays_seconds=retry_delays,
            catch_up_after_start=bool(
                arena.get("catch_up_after_start", True)
            ),
        ),
        refresh_automation=RefreshAutomationConfig(
            enabled=bool(refresh.get("enabled", False)),
            weekly_enabled=bool(refresh.get("weekly_enabled", True)),
            weekly_weekday_utc=refresh_weekday,
            reset_hour_utc=refresh_reset_hour,
            reset_minute_utc=refresh_reset_minute,
            weekly_delay_seconds=max(
                0, int(refresh.get("weekly_delay_seconds", 300))
            ),
            idle_seconds_required=max(
                30, int(refresh.get("idle_seconds_required", 300))
            ),
            poll_seconds=max(5, int(refresh.get("poll_seconds", 30))),
            interrupt_check_seconds=max(
                0.25, float(refresh.get("interrupt_check_seconds", 1.0))
            ),
            adb_path=_optional_text(
                refresh.get("adb_path", arena.get("adb_path"))
            ),
            device_serial=_optional_text(
                refresh.get("device_serial", arena.get("device_serial"))
            ),
            package=str(
                refresh.get(
                    "package", arena.get("package", "com.readygo.dark.gp")
                )
            ),
            sequence_dir=Path(
                refresh.get("sequence_dir", "data/refresh_sequences")
            ),
            launch_wait_seconds=max(
                0.0, float(refresh.get("launch_wait_seconds", 25.0))
            ),
            tap_wait_seconds=max(
                0.0, float(refresh.get("tap_wait_seconds", 3.0))
            ),
            verification_timeout_seconds=max(
                5, int(refresh.get("verification_timeout_seconds", 75))
            ),
            max_attempts=max(1, int(refresh.get("max_attempts", 3))),
            catch_up_weekly=bool(refresh.get("catch_up_weekly", True)),
        ),
        discord_activity=DiscordActivityConfig(
            enabled=bool(discord_activity.get("enabled", False)),
            host=str(discord_activity.get("host", "127.0.0.1")),
            port=max(1, int(discord_activity.get("port", 8765))),
            viewer_user_ids=tuple(
                str(value).strip()
                for value in discord_activity.get("viewer_user_ids", [])
                if str(value).strip()
            ),
            admin_user_ids=tuple(
                str(value).strip()
                for value in discord_activity.get("admin_user_ids", [])
                if str(value).strip()
            ),
            timezone=str(
                discord_activity.get("timezone", "America/New_York")
            ),
            max_rows=max(10, int(discord_activity.get("max_rows", 200))),
            allow_dev_bypass=bool(
                discord_activity.get("allow_dev_bypass", False)
            ),
        ),
    )
