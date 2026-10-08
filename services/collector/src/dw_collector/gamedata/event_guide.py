"""What scores in Survival Preparedness and the Alliance Duel, from the game.

Both are weeks of themed events. The server sends the shape (`hero.event.info.get`: each
theme with the ids of what scores in it; `get.hero.event.calendar`: which theme runs in
which slot of which day) and the client's own `score` datatable says what each id is and
what it is worth. Nothing about any member is read: the points a person actually earns
vary with their buffs, so the guide lists what scores and the base value, not a result.

  activity 100004  Survival Preparedness   five themes, six 4-hour slots a day
  activity 70005   Alliance Duel           one theme a day, with a daily and a weekly
                                           score to reach (`minDayScore`, `minWeekScore`)

`score` row: `name` is a localisation key, `value` is the amount one `points` is paid for
(`1` and `100` both occur: "per 100 power", "per kill"), `points` what it is worth.

The captures come from the collector's journal, so this runs on the collector machine
(docs/runbooks/game-data.md); the themes rotate by week but their shape rarely changes, so
it is re-run after a game update or when a theme looks wrong, not on a schedule.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from dw_collector.gamedata.luatable import decode
from dw_collector.gamedata.names import datatable_bytes, localisation

ACTIVITIES = {"100004": "survival_preparedness", "70005": "alliance_duel"}


@dataclass(frozen=True)
class Guide:
    themes: list[dict[str, Any]] = field(default_factory=list)
    scores: list[dict[str, Any]] = field(default_factory=list)
    calendar: list[dict[str, Any]] = field(default_factory=list)


def _int(value: Any) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def build(
    assets: Mapping[str, bytes],
    observations: Iterable[tuple[str, dict[str, Any]]],
) -> Guide:
    """The guide from the client's bundles and the journal's captures."""
    return build_from(
        localisation(assets),
        localisation(assets, "Korean"),
        decode(datatable_bytes(assets, "score"), "score").rows,
        observations,
    )


def build_from(
    english: Mapping[str, str],
    korean: Mapping[str, str],
    score_table: Mapping[str, Mapping[str, Any]],
    observations: Iterable[tuple[str, dict[str, Any]]],
) -> Guide:
    """`observations` are (command, payload), NEWEST FIRST: for a theme seen in
    several weeks the newest capture wins."""
    themes: dict[tuple[str, str], dict[str, Any]] = {}
    scores: dict[tuple[str, str, str], dict[str, Any]] = {}
    calendar: dict[tuple[str, int, int], dict[str, Any]] = {}

    def text(key: Any) -> tuple[str | None, str | None]:
        k = str(key).strip() if key not in (None, "") else ""
        en, ko = english.get(k), korean.get(k)
        return (en.strip() or None) if en else None, (ko.strip() or None) if ko else None

    for command, payload in observations:
        if command == "hero.event.info.get":
            activity = str(payload.get("activityId", ""))
            if activity not in ACTIVITIES:
                continue
            for event in payload.get("eventList") or []:
                event_id = str(event.get("eventId", ""))
                if not event_id or (activity, event_id) in themes:
                    continue
                name_en, name_ko = text(event.get("actName"))
                themes[(activity, event_id)] = {
                    "activity_id": activity,
                    "event_id": event_id,
                    "day": _int(event.get("day")),
                    "name": name_en,
                    "name_ko": name_ko,
                    "min_day_score": _int(event.get("minDayScore")),
                    "min_week_score": _int(event.get("minWeekScore")),
                }
                for order, score_id in enumerate(str(event.get("score", "")).split("|")):
                    row = score_table.get(score_id.strip())
                    if row is None:
                        continue
                    action_en, action_ko = text(row.get("name"))
                    per_value, points = _int(row.get("value")), _int(row.get("points"))
                    if per_value is None or points is None:
                        continue
                    scores[(activity, event_id, score_id.strip())] = {
                        "activity_id": activity,
                        "event_id": event_id,
                        "score_id": score_id.strip(),
                        "action": action_en,
                        "action_ko": action_ko,
                        "per_value": per_value,
                        "points": points,
                        "sort_order": order,
                    }
        elif command == "get.hero.event.calendar":
            for day in payload.get("dayArr") or []:
                day_number = _int(day.get("day"))
                for slot, event in enumerate(day.get("eventArr") or [], start=1):
                    key = ("100004", day_number or 0, slot)
                    if day_number is not None and key not in calendar:
                        calendar[key] = {
                            "activity_id": "100004",
                            "day": day_number,
                            "slot": slot,
                            "event_id": str(event.get("eventId", "")),
                        }

    return Guide(
        themes=sorted(themes.values(), key=lambda r: (r["activity_id"], r["event_id"])),
        scores=sorted(
            scores.values(), key=lambda r: (r["activity_id"], r["event_id"], r["sort_order"])
        ),
        calendar=sorted(calendar.values(), key=lambda r: (r["day"], r["slot"])),
    )


def read_journal(path: str, limit: int = 600) -> list[tuple[str, dict[str, Any]]]:
    """The newest hero-event captures in a journal, newest first, read-only."""
    import sqlite3

    reader = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = reader.execute(
            "select source_command, payload_json from raw_observations"
            " where source_command in ('hero.event.info.get', 'get.hero.event.calendar')"
            " order by captured_at desc limit ?",
            (limit,),
        ).fetchall()
    finally:
        reader.close()
    return [(command, json.loads(payload)) for command, payload in rows]
