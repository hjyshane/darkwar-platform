"""Station numbers become map points, from the truck marches a journal holds (0259)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from dw_collector.gamedata.train_stations import learn


def _push(stations: list[int], index: int, start: int, target: int, kind: int = 15) -> str:
    return json.dumps(
        {
            "type": kind,
            "startPos": start,
            "targetPos": target,
            "train": {"stationList": stations, "marchInfo": {"lastPosIndex": index}},
        }
    )


def _journal(path: Path, pushes: list[str]) -> str:
    connection = sqlite3.connect(path)
    connection.execute("create table raw_observations (source_command text, payload_json text)")
    connection.executemany(
        "insert into raw_observations values ('push.world.march.new', ?)",
        [(p,) for p in pushes],
    )
    connection.commit()
    connection.close()
    return str(path)


def test_the_leg_runs_from_the_station_before_to_the_station_at_the_index(tmp_path: Path) -> None:
    journal = _journal(tmp_path / "j.db", [_push([43, 56, 60], 1, 491444, 691392)])

    rows, contested = learn(journal)

    assert contested == 0
    assert {r["station_no"]: r["point_id"] for r in rows} == {43: 491444, 56: 691392}
    assert (rows[0]["x"], rows[0]["y"]) == (443, 491)


def test_a_station_seen_at_two_points_is_left_out_not_guessed(tmp_path: Path) -> None:
    journal = _journal(
        tmp_path / "j.db",
        [_push([43, 56], 1, 100001, 200001), _push([43, 60], 1, 999001, 300001)],
    )

    rows, contested = learn(journal)

    assert contested == 1
    assert [r["station_no"] for r in rows] == [56, 60]


def test_other_marches_and_bad_indexes_teach_nothing(tmp_path: Path) -> None:
    journal = _journal(
        tmp_path / "j.db",
        [
            _push([43, 56], 1, 1, 2, kind=3),
            _push([43, 56], 0, 1, 2),
            _push([43, 56], 9, 1, 2),
        ],
    )

    assert learn(journal) == ([], 0)
