"""What scores in each event the journal has seen, from the game (0248, 0309).

The server sends the shape (`hero.event.info.get`: each theme with the ids of what
scores in it; `get.hero.event.calendar`: which theme runs in which slot of which day)
and the client's own `score` datatable says what each id is and what it is worth.
Nothing about any member is read: the points a person actually earns vary with their
buffs, so the guide lists what scores and the base value, not a result.

  activity 100004  Survival Preparedness   five themes, six 4-hour slots a day
  activity 70005   Alliance Duel           one theme a day, with a daily and a weekly
                                           score to reach (`minDayScore`, `minWeekScore`)
  anything else    whatever the collector's account has opened: the reach of this
                   importer is "every activity that packet has described", no more.
                   An activity whose `score` field is a threshold rather than a list
                   of score ids (100003, 2026-11-08) has nothing that scores and gets
                   no guide; it is reported as `scoreless`.

`score` row: `name` is a localisation key, `value` is the amount one `points` is paid for
(`1` and `100` both occur: "per 100 power", "per kill"), `points` what it is worth.

Besides the three 0248 tables, each activity with at least one score row gets an
`event_guides` row (created once, unpublished, never overwritten) and one `client`
`point_table` section per theme in `event_guide_sections`. Client sections are
replaced on every run; officer sections and `game_event_score_items` are never
touched.

The captures come from the collector's journal, so this runs on the collector machine
(docs/runbooks/game-data.md); the themes rotate by week but their shape rarely changes, so
it is re-run after a game update or when a theme looks wrong, not on a schedule.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

import httpx

from dw_collector.gamedata.luatable import decode
from dw_collector.gamedata.names import datatable_bytes, event_names, localisation
from dw_collector.gamedata.upload import BATCH


@dataclass(frozen=True)
class Guide:
    themes: list[dict[str, Any]] = field(default_factory=list)
    scores: list[dict[str, Any]] = field(default_factory=list)
    calendar: list[dict[str, Any]] = field(default_factory=list)
    # 0309: one guide per activity that scores, one client section per theme.
    guides: list[dict[str, Any]] = field(default_factory=list)
    sections: list[dict[str, Any]] = field(default_factory=list)
    # Every activity id the journal described, and the two lists the operator acts on.
    activities: list[str] = field(default_factory=list)
    scoreless: list[str] = field(default_factory=list)
    unnamed: list[str] = field(default_factory=list)


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
    names = {activity_id: event.name for activity_id, event in event_names(assets).items()}
    return build_from(
        localisation(assets),
        localisation(assets, "Korean"),
        decode(datatable_bytes(assets, "score"), "score").rows,
        observations,
        names,
    )


def build_from(
    english: Mapping[str, str],
    korean: Mapping[str, str],
    score_table: Mapping[str, Mapping[str, Any]],
    observations: Iterable[tuple[str, dict[str, Any]]],
    names: Mapping[str, str] | None = None,
) -> Guide:
    """`observations` are (command, payload), NEWEST FIRST: for a theme seen in
    several weeks the newest capture wins. `names` is activity id → the client's
    name for it (names.event_names), used as the title of a guide this creates."""
    themes: dict[tuple[str, str], dict[str, Any]] = {}
    scores: dict[tuple[str, str, str], dict[str, Any]] = {}
    calendar: dict[tuple[str, int, int], dict[str, Any]] = {}
    activities: set[str] = set()

    def text(key: Any) -> tuple[str | None, str | None]:
        k = str(key).strip() if key not in (None, "") else ""
        en, ko = english.get(k), korean.get(k)
        return (en.strip() or None) if en else None, (ko.strip() or None) if ko else None

    observed = list(observations)
    for command, payload in observed:
        if command != "hero.event.info.get":
            continue
        activity = str(payload.get("activityId") or "")
        if not activity:
            continue
        activities.add(activity)
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

    # The calendar packet names no activity; the theme that owns each event does.
    # Second pass so every theme is known before the first calendar row is read.
    owner = {event_id: activity for activity, event_id in themes}
    for command, payload in observed:
        if command != "get.hero.event.calendar":
            continue
        for day in payload.get("dayArr") or []:
            day_number = _int(day.get("day"))
            if day_number is None:
                continue
            for slot, event in enumerate(day.get("eventArr") or [], start=1):
                event_id = str(event.get("eventId", ""))
                owning = owner.get(event_id)
                if owning is None or (owning, day_number, slot) in calendar:
                    continue
                calendar[(owning, day_number, slot)] = {
                    "activity_id": owning,
                    "day": day_number,
                    "slot": slot,
                    "event_id": event_id,
                }

    sorted_themes = sorted(themes.values(), key=lambda r: (r["activity_id"], r["event_id"]))
    sorted_scores = sorted(
        scores.values(), key=lambda r: (r["activity_id"], r["event_id"], r["sort_order"])
    )
    guides, sections, scoreless, unnamed = _guides_and_sections(
        sorted_themes, sorted_scores, sorted(activities), names or {}
    )
    return Guide(
        themes=sorted_themes,
        scores=sorted_scores,
        calendar=sorted(calendar.values(), key=lambda r: (r["activity_id"], r["day"], r["slot"])),
        guides=guides,
        sections=sections,
        activities=sorted(activities),
        scoreless=scoreless,
        unnamed=unnamed,
    )


def _guides_and_sections(
    themes: list[dict[str, Any]],
    scores: list[dict[str, Any]],
    activities: list[str],
    names: Mapping[str, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], list[str]]:
    """One unpublished guide per activity that scores; one client point_table
    section per theme that scores, `day` from the theme (null for Survival
    Preparedness, whose themes rotate through slots and belong to no one day)."""
    rows_by_theme: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for score in scores:
        rows_by_theme.setdefault((score["activity_id"], score["event_id"]), []).append(
            {
                "score_id": score["score_id"],
                "action": score["action"],
                "points": score["points"],
                "per": score["per_value"],
            }
        )
    scoring = {activity for activity, _ in rows_by_theme}

    guides: list[dict[str, Any]] = []
    unnamed: list[str] = []
    for activity in activities:
        if activity not in scoring:
            continue
        title = names.get(activity)
        if title is None:
            unnamed.append(activity)
        guides.append(
            {
                "activity_id": activity,
                "slug": f"activity-{activity}",
                "title": title or f"Activity {activity}",
                "published": False,
            }
        )

    sections: list[dict[str, Any]] = []
    for index, theme in enumerate(themes):
        rows = rows_by_theme.get((theme["activity_id"], theme["event_id"]))
        if not rows:
            continue
        sections.append(
            {
                "activity_id": theme["activity_id"],
                "kind": "point_table",
                "source": "client",
                "title": theme["name"],
                "sort_order": theme["day"] if theme["day"] is not None else index,
                "payload": {"day": theme["day"], "theme": theme["name"], "rows": rows},
            }
        )
    scoreless = [activity for activity in activities if activity not in scoring]
    return guides, sections, scoreless, unnamed


def dry_run_report(guide: Guide) -> str:
    """The one line `--dry-run` prints: counts, then the ids the operator acts on
    (`scoreless` has nothing to import; `unnamed` wants `game-names` first)."""
    return (
        f"activities={len(guide.activities)} themes={len(guide.themes)}"
        f" scores={len(guide.scores)} calendar={len(guide.calendar)}"
        f" guides={len(guide.guides)} sections={len(guide.sections)}"
        f" scoreless=[{','.join(guide.scoreless)}] unnamed=[{','.join(guide.unnamed)}]"
    )


def write_guides(client: httpx.Client, guide: Guide) -> tuple[int, int]:
    """Create the guides that do not exist yet and replace every client section
    under them. Returns (guide rows sent, section rows sent).

    Guides are INSERTED, never updated: `ignore-duplicates` on `activity_id`
    leaves an officer's title, slug and published flag alone. Sections are
    deleted and re-inserted, but only `source = 'client'` ones, so an officer's
    sections under the same guide survive. game_event_score_items is not read
    or written here.
    """
    if not guide.guides:
        return 0, 0
    resp = client.post(
        "/rest/v1/event_guides",
        params={"on_conflict": "activity_id"},
        json=guide.guides,
        headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
    )
    resp.raise_for_status()

    ids = ",".join(g["activity_id"] for g in guide.guides)
    resp = client.get(
        "/rest/v1/event_guides",
        params={"select": "guide_id,activity_id", "activity_id": f"in.({ids})"},
    )
    resp.raise_for_status()
    guide_ids = {str(row["activity_id"]): str(row["guide_id"]) for row in resp.json()}

    resp = client.delete(
        "/rest/v1/event_guide_sections",
        params={"guide_id": f"in.({','.join(guide_ids.values())})", "source": "eq.client"},
        headers={"Prefer": "return=minimal"},
    )
    resp.raise_for_status()

    rows = [
        {"guide_id": guide_ids[section["activity_id"]], **rest}
        for section in guide.sections
        if section["activity_id"] in guide_ids
        for rest in [{k: v for k, v in section.items() if k != "activity_id"}]
    ]
    for start in range(0, len(rows), BATCH):
        resp = client.post(
            "/rest/v1/event_guide_sections",
            json=rows[start : start + BATCH],
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()
    return len(guide.guides), len(rows)


def read_journal(path: str, limit: int = 5000) -> list[tuple[str, dict[str, Any]]]:
    """The newest hero-event captures in a journal, newest first, read-only.

    `limit` applies to each command separately. The collector captures the theme list
    (`hero.event.info.get`) thousands of times a week and the calendar far less, so one
    shared cap let the busy command push a week's older Duel days out of the window.
    """
    import sqlite3

    reader = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows: list[tuple[str, str, str]] = []
        for command in ("hero.event.info.get", "get.hero.event.calendar"):
            rows.extend(
                reader.execute(
                    "select captured_at, source_command, payload_json from raw_observations"
                    " where source_command = ? order by captured_at desc limit ?",
                    (command, limit),
                ).fetchall()
            )
    finally:
        reader.close()
    rows.sort(key=lambda row: row[0], reverse=True)
    return [(command, json.loads(payload)) for _, command, payload in rows]
