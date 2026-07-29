from __future__ import annotations

from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from darkwar_tracker.database import Database


def main() -> int:
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = Path(temp_dir) / "null_rank_names.sqlite3"
        database = Database(db_path)

        payload = {
            "allianceId": "test-alliance",
            "rankName": None,
            "list": [
                {
                    "uid": "player-1",
                    "name": "Test Player",
                    "serverId": 580,
                    "power": 123456789,
                    "mainCityLv": 40,
                    "rank": 3,
                    "online": True,
                    "offLineTime": 0,
                    "pointId": 0,
                    "rawBadge": b"\x00\x01",
                }
            ],
        }

        try:
            alliance_id, count = database.save_member_snapshot(
                payload,
                "2026-07-27T22:35:00+00:00",
            )
        finally:
            database.close()

        connection = sqlite3.connect(db_path)
        try:
            snapshot_count = connection.execute(
                "SELECT COUNT(*) FROM member_snapshots"
            ).fetchone()[0]
            row = connection.execute(
                """
                SELECT player_uid, alliance_rank, rank_name
                FROM member_entries
                """
            ).fetchone()
        finally:
            connection.close()

        assert alliance_id == "test-alliance"
        assert count == 1
        assert snapshot_count == 1
        assert row == ("player-1", 3, None)

    print("rankName=null regression test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
