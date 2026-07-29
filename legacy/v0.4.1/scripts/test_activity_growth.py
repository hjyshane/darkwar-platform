from __future__ import annotations

import datetime as dt
from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from darkwar_tracker.database import Database


def epoch(value: str) -> int:
    return int(dt.datetime.fromisoformat(value).timestamp())


def member(
    uid: str,
    name: str,
    *,
    power: int,
    hq: int,
    kills: int,
    pass_expiry: int | None,
) -> dict:
    return {
        "uid": uid,
        "name": name,
        "serverId": 580,
        "power": power,
        "mainCityLv": hq,
        "rank": 3,
        "online": False,
        "offLineTime": 1780000000000,
        "pointId": 1,
        "armyKill": kills,
        "monthCardEndTime": pass_expiry,
    }


def main() -> int:
    t1 = "2026-07-01T00:00:00+00:00"
    t2 = "2026-07-10T00:00:00+00:00"

    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = Path(temp_dir) / "activity.sqlite3"
        database = Database(db_path)
        try:
            database.save_member_snapshot(
                {
                    "allianceId": "alliance-1",
                    "rankName": None,
                    "list": [
                        member(
                            "a",
                            "Renewed",
                            power=100,
                            hq=30,
                            kills=1000,
                            pass_expiry=epoch("2026-07-20T00:00:00+00:00"),
                        ),
                        member(
                            "b",
                            "Activated",
                            power=200,
                            hq=31,
                            kills=2000,
                            pass_expiry=-1,
                        ),
                        member(
                            "c",
                            "Expired",
                            power=300,
                            hq=32,
                            kills=3000,
                            pass_expiry=epoch("2026-07-05T00:00:00+00:00"),
                        ),
                        member(
                            "e",
                            "Left",
                            power=400,
                            hq=33,
                            kills=4000,
                            pass_expiry=None,
                        ),
                    ],
                },
                t1,
            )

            database.save_member_snapshot(
                {
                    "allianceId": "alliance-1",
                    "rankName": None,
                    "list": [
                        member(
                            "a",
                            "Renewed",
                            power=150,
                            hq=31,
                            kills=1100,
                            pass_expiry=epoch("2026-08-20T00:00:00+00:00"),
                        ),
                        member(
                            "b",
                            "Activated",
                            power=220,
                            hq=31,
                            kills=2100,
                            pass_expiry=epoch("2026-08-01T00:00:00+00:00"),
                        ),
                        member(
                            "c",
                            "Expired",
                            power=310,
                            hq=32,
                            kills=3050,
                            pass_expiry=epoch("2026-07-05T00:00:00+00:00"),
                        ),
                        member(
                            "d",
                            "Joined",
                            power=500,
                            hq=35,
                            kills=5000,
                            pass_expiry=None,
                        ),
                    ],
                },
                t2,
            )
        finally:
            database.close()

        connection = sqlite3.connect(db_path)
        try:
            event_types = [
                row[0]
                for row in connection.execute(
                    "SELECT event_type FROM member_change_events"
                ).fetchall()
            ]
            power_delta = connection.execute(
                """
                SELECT numeric_delta
                FROM member_change_events
                WHERE player_uid = 'a' AND event_type = 'power_changed'
                """
            ).fetchone()[0]
        finally:
            connection.close()

        expected = {
            "joined",
            "left",
            "power_changed",
            "hq_changed",
            "kills_changed",
            "monthly_pass_activated",
            "monthly_pass_renewed",
            "monthly_pass_expired",
        }
        assert expected.issubset(set(event_types)), event_types
        assert power_delta == 50

    print("activity and monthly-pass regression test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
