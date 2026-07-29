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
        db_path = Path(temp_dir) / 'arena.sqlite3'
        db = Database(db_path)
        payload = {
            '_id': 10,
            'fightServers': '580;582',
            'startTime': 1785117600000,
            'endTime': 1785722400000,
            'arenaType': 1,
            'userArenaType': 1,
            'selfArenaType': 1,
            'power': 286963138,
            'allianceTopRank': 4,
            'stormLowestRank': 200,
            'rankArr': [
                {
                    'uid': 'p1',
                    'name': 'One',
                    'serverId': 580,
                    'nowServer': 580,
                    'rank': 1,
                    'score': 1213,
                    'power': 296837700,
                    'abbr': 'GAR7',
                    'alName': 'GARUDAKU',
                    'mainBuildPoint': 428508,
                    'army': 'encoded-one',
                },
                {
                    'uid': 'p2',
                    'name': 'Two',
                    'serverId': 582,
                    'nowServer': 582,
                    'rank': 2,
                    'score': 1209,
                    'power': 423157907,
                    'abbr': 'EOWV',
                    'alName': 'EMPIRE OF WAR',
                    'mainBuildPoint': 499590,
                    'army': 'encoded-two',
                },
            ],
        }
        try:
            result = db.handle_event(
                'inbound', 'user.get.arena.info', payload, 10,
                '2026-07-27T23:00:00+00:00'
            )
            assert result == 'saved arena match=1: 2 players'
            db.handle_event(
                'outbound',
                'user.arena.save.defend.army',
                {
                    '_id': 11,
                    'armyId': '107009',
                    'power': 286963138,
                    'heroes': [{'uuid': 1, 'index': 1}],
                },
                11,
                '2026-07-27T23:01:00+00:00',
            )
        finally:
            db.close()

        connection = sqlite3.connect(db_path)
        try:
            match = connection.execute(
                'SELECT base_server, opponent_servers, status '
                'FROM arena_matches'
            ).fetchone()
            snapshot = connection.execute(
                'SELECT player_count, own_defense_power '
                'FROM arena_snapshots'
            ).fetchone()
            entries = connection.execute(
                'SELECT COUNT(*) FROM arena_ranking_entries'
            ).fetchone()[0]
            defense = connection.execute(
                'SELECT army_id, requested_power '
                'FROM arena_defense_snapshots'
            ).fetchone()
        finally:
            connection.close()

        assert match == (580, '582', 'active')
        assert snapshot == (2, 286963138)
        assert entries == 2
        assert defense == ('107009', 286963138)

    print('arena weekly regression test passed')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
