from __future__ import annotations

import datetime as dt
from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from darkwar_tracker.config import load_config
from darkwar_tracker.database import Database
from darkwar_tracker.refresh_control import (
    all_freshness,
    cancel_job,
    current_week_window,
    ensure_weekly_job,
    queue_job,
)
from darkwar_tracker.refresh_worker import RefreshWorker, requeue_ready_setup_jobs
import logging

UTC = dt.timezone.utc


CONFIG_TEXT = """
[capture]
interface = ""
port = 8680
server_ip = ""

[database]
path = "{database_path}"

[tracking]
servers = [577, 578, 579, 580, 581, 582, 583, 584]
top_n = 3

[activity]
own_alliance_code = "CBFW"
auto_refresh_seconds = 0
inactive_warning_days = 3
inactive_critical_days = 7
pass_expiry_warning_days = 7

[arena_automation]
enabled = false

[refresh_automation]
enabled = true
weekly_enabled = true
weekly_weekday_utc = 0
reset_hour_utc = 2
reset_minute_utc = 0
weekly_delay_seconds = 300
idle_seconds_required = 300
poll_seconds = 5
interrupt_check_seconds = 1
sequence_dir = "{sequence_dir}"
launch_wait_seconds = 1
tap_wait_seconds = 1
verification_timeout_seconds = 5
max_attempts = 3
catch_up_weekly = true
"""


def seed_current_snapshots(
    connection: sqlite3.Connection,
    captured_at: str,
) -> None:
    connection.execute(
        """
        INSERT INTO alliances (
            alliance_id, server_id, code, full_name, updated_at
        ) VALUES ('own', 580, 'CBFW', 'Tempest', ?)
        """,
        (captured_at,),
    )
    connection.execute(
        """
        INSERT INTO alliances (
            alliance_id, server_id, code, full_name, updated_at
        ) VALUES ('tracked', 581, 'ANI', 'Tracked', ?)
        """,
        (captured_at,),
    )
    connection.execute(
        """
        INSERT INTO tracked_alliances (
            alliance_id, server_id, server_rank, enabled, updated_at
        ) VALUES ('tracked', 581, 1, 1, ?)
        """,
        (captured_at,),
    )
    connection.execute(
        """
        INSERT INTO member_snapshots (
            captured_at, alliance_id, member_count,
            presence_redacted, raw_json
        ) VALUES (?, 'own', 1, 0, '{}')
        """,
        (captured_at,),
    )
    connection.execute(
        """
        INSERT INTO member_snapshots (
            captured_at, alliance_id, member_count,
            presence_redacted, raw_json
        ) VALUES (?, 'tracked', 1, 1, '{}')
        """,
        (captured_at,),
    )
    connection.execute(
        """
        INSERT INTO ranking_snapshots (
            captured_at, range_type, is_merge, source_request_id
        ) VALUES (?, 1, 0, 1)
        """,
        (captured_at,),
    )
    connection.execute(
        """
        INSERT INTO player_ranking_snapshots (
            captured_at, range_type, is_merge, source_request_id,
            raw_json
        ) VALUES (?, 1, 0, 2, '{}')
        """,
        (captured_at,),
    )
    connection.execute(
        """
        INSERT INTO arena_matches (
            base_server, fight_servers, opponent_servers,
            start_time_ms, end_time_ms, user_arena_type,
            status, first_seen_at, last_seen_at
        ) VALUES (580, '580;582', '582', 1, 2, 1,
                  'active', ?, ?)
        """,
        (captured_at, captured_at),
    )
    match_id = connection.execute(
        "SELECT match_id FROM arena_matches"
    ).fetchone()[0]
    connection.execute(
        """
        INSERT INTO arena_snapshots (
            match_id, captured_at, player_count, raw_json
        ) VALUES (?, ?, 100, '{}')
        """,
        (match_id, captured_at),
    )


def main() -> int:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        db_path = root / "test.sqlite3"
        sequence_dir = root / "sequences"
        config_path = root / "config.toml"
        config_path.write_text(
            CONFIG_TEXT.format(
                database_path=db_path.as_posix(),
                sequence_dir=sequence_dir.as_posix(),
            ),
            encoding="utf-8",
        )
        config = load_config(config_path)

        database = Database(db_path)
        database.close()

        monday_0204 = dt.datetime(2026, 7, 27, 2, 4, tzinfo=UTC)
        window = current_week_window(monday_0204, config)
        assert window.reset_at == dt.datetime(2026, 7, 27, 2, 0, tzinfo=UTC)
        assert window.scheduled_at == dt.datetime(2026, 7, 27, 2, 5, tzinfo=UTC)

        before_reset = dt.datetime(2026, 7, 27, 1, 59, tzinfo=UTC)
        previous = current_week_window(before_reset, config)
        assert previous.reset_at == dt.datetime(2026, 7, 20, 2, 0, tzinfo=UTC)

        assert ensure_weekly_job(db_path, config, now=monday_0204) is None
        weekly_id = ensure_weekly_job(
            db_path,
            config,
            now=dt.datetime(2026, 7, 27, 2, 6, tzinfo=UTC),
        )
        assert weekly_id is not None
        assert ensure_weekly_job(
            db_path,
            config,
            now=dt.datetime(2026, 7, 27, 3, 0, tzinfo=UTC),
        ) == weekly_id

        manual_id = queue_job(
            db_path,
            "arena",
            config=config,
            trigger_type="manual",
            fresh_after=dt.datetime(2026, 7, 27, 3, 0, tzinfo=UTC),
        )
        assert queue_job(
            db_path,
            "arena",
            config=config,
            trigger_type="manual",
            fresh_after=dt.datetime(2026, 7, 27, 3, 1, tzinfo=UTC),
        ) == manual_id
        assert cancel_job(db_path, manual_id)

        captured_at = "2026-07-27T02:10:00+00:00"
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                seed_current_snapshots(connection, captured_at)
            freshness = all_freshness(
                connection,
                dt.datetime(2026, 7, 27, 2, 0, tzinfo=UTC),
                config,
            )
            assert all(value.current for value in freshness.values())
            assert freshness["tracked_alliances"].coverage_current == 1
            assert freshness["tracked_alliances"].coverage_total == 1

            # The weekly job is completed from passive snapshots without ADB.
            assert RefreshWorker(
                config, logging.getLogger("test.refresh")
            ).process_job(int(weekly_id))
            weekly_status = connection.execute(
                "SELECT status FROM refresh_jobs WHERE job_id=?",
                (weekly_id,),
            ).fetchone()[0]
            assert weekly_status == "succeeded"

            # A setup-blocked job becomes runnable after its sequence exists.
            setup_job = queue_job(
                db_path,
                "rankings",
                config=config,
                trigger_type="manual",
                fresh_after=dt.datetime(2026, 7, 28, 2, 0, tzinfo=UTC),
            )
            with connection:
                connection.execute(
                    "UPDATE refresh_jobs SET status='waiting_setup' WHERE job_id=?",
                    (setup_job,),
                )
                connection.execute(
                    """
                    UPDATE refresh_job_steps
                    SET status='waiting_setup'
                    WHERE job_id=?
                    """,
                    (setup_job,),
                )
            sequence_dir.mkdir(parents=True)
            (sequence_dir / "rankings.json").write_text(
                '{"version":1,"screen_size":{"width":100,"height":100},'
                '"steps":[{"label":"x","x":1,"y":1}]}',
                encoding="utf-8",
            )
        finally:
            connection.close()

        assert requeue_ready_setup_jobs(db_path, config) == 1
        connection = sqlite3.connect(db_path)
        try:
            status = connection.execute(
                "SELECT status FROM refresh_jobs WHERE job_id=?",
                (setup_job,),
            ).fetchone()[0]
            assert status == "queued"
        finally:
            connection.close()

    print("refresh policy regression test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
