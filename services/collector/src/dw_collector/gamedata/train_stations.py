"""Where the Dark Syndicate truck stations are on the map (0258).

A truck's route is a list of station NUMBERS and nothing in the client's data
tables says where station 43 is. The map does, though: every truck march push
names the leg it is on as two map points, and the push carries the route and
which station the truck is heading for. For `lastPosIndex = i` the leg runs from
`stationList[i - 1]` to `stationList[i]` - the only pairing out of nine tried
that gave one point per station across 8,784 pushes (the rest: 77 to 83 stations
with several points each).

The pushes only reach the collector for its own server's trucks, but the layout
is shared: for 2,343 legs of trucks from servers 577-588, the distance between
the stations over the leg's duration is 0.25 tiles/s, the truck speed, to the
digit. So a station table learned here places every server's trucks.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from dw_collector.protocol.worldmap import MAP_WIDTH

MARCH_COMMAND = "push.world.march.new"
_TRUCK_MARCH = 15


def learn(journal_path: str) -> tuple[list[dict[str, Any]], int]:
    """Station number -> map point, from a journal's truck march pushes.

    Returns the rows and the number of stations that were seen with MORE than
    one point (a station that moves would make the table a guess; the rows for
    those are left out rather than picked between).
    """
    points: dict[int, set[int]] = {}
    connection = sqlite3.connect(f"file:{journal_path}?mode=ro", uri=True)
    try:
        cursor = connection.execute(
            "select payload_json from raw_observations "
            "where source_command = ? and payload_json like '%stationList%'",
            (MARCH_COMMAND,),
        )
        for (payload,) in cursor:
            push = json.loads(payload)
            if push.get("type") != _TRUCK_MARCH:
                continue
            train = push.get("train")
            if not isinstance(train, dict):
                continue
            stations = train.get("stationList")
            info = train.get("marchInfo")
            index = info.get("lastPosIndex") if isinstance(info, dict) else None
            start, target = push.get("startPos"), push.get("targetPos")
            if (
                not isinstance(stations, list)
                or not isinstance(index, int)
                or not 1 <= index < len(stations)
                or not isinstance(start, int)
                or not isinstance(target, int)
            ):
                continue
            points.setdefault(stations[index - 1], set()).add(start)
            points.setdefault(stations[index], set()).add(target)
    finally:
        connection.close()
    rows = [
        {
            "station_no": station,
            "point_id": next(iter(seen)),
            "x": next(iter(seen)) % MAP_WIDTH - 1,
            "y": next(iter(seen)) // MAP_WIDTH,
        }
        for station, seen in sorted(points.items())
        if len(seen) == 1
    ]
    return rows, sum(1 for seen in points.values() if len(seen) > 1)
