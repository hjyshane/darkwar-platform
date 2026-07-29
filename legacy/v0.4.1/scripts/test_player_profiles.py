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
        db_path = Path(temp_dir) / "profiles.sqlite3"
        database = Database(db_path)
        captured_at = "2026-07-27T23:30:00+00:00"

        database.handle_event(
            "inbound",
            "server.rank",
            {
                "_id": 1,
                "serverRanking": [
                    {
                        "uid": "player-1",
                        "name": "Test",
                        "serverId": 580,
                        "rank": 1,
                        "power": 210,
                        "lv": 45,
                        "abbr": "TEST",
                        "allianceName": "Test Alliance",
                    }
                ],
            },
            1,
            captured_at,
        )

        database.handle_event(
            "inbound",
            "get.new.user.info",
            {
                "_id": 2,
                "uid": "player-1",
                "name": "Test",
                "serverId": 580,
                "power": 210,
                "playerMaxPower": 250,
                "buildingPower": 10,
                "sciencePower": 20,
                "heroPower": 30,
                "armyPower": 100,
                "modCarPower": 40,
                "petPower": 10,
                "baseLevel": 45,
            },
            2,
            captured_at,
        )

        database.handle_event(
            "inbound",
            "get.user.info.multi",
            {
                "_id": 3,
                "uids": [
                    {
                        "uid": "player-1",
                        "name": "Test",
                        "serverId": 580,
                        "power": 210,
                        "vipLevel": 10,
                        "maxHeroId": 40001,
                        "maxPower": 7000000,
                    }
                ],
            },
            3,
            captured_at,
        )
        database.close()

        connection = sqlite3.connect(db_path)
        try:
            ranking = connection.execute(
                "SELECT COUNT(*) FROM player_ranking_entries"
            ).fetchone()[0]
            profile = connection.execute(
                """
                SELECT current_power, building_power, science_power,
                       hero_power, army_power, vehicle_power, pet_power
                FROM player_profile_snapshots
                """
            ).fetchone()
            public = connection.execute(
                "SELECT vip_level FROM player_public_info_snapshots"
            ).fetchone()
        finally:
            connection.close()

        assert ranking == 1
        assert profile[0] == sum(profile[1:])
        assert public[0] == 10

    print("player profile regression test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
