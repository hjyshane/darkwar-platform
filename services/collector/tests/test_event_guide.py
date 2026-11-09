"""What scores in each event the journal has seen (0248, 0309).

What this pins: the shape of the guide built from the server's theme lists and the
client's score table, with the real ids seen in the journal on 2026-10-08, and the
guide/section rows the importer adds for 0309. The payloads are trimmed to the fields
read; no member's score is in them.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import httpx
import pytest

from dw_collector.gamedata import event_guide
from dw_collector.gamedata.event_guide import (
    Guide,
    build_from,
    dry_run_report,
    read_journal,
    write_guides,
)

ENGLISH = {
    "370026": "Training Day",
    "371026": "Showdown",
    "370006": "Gather resources",
    "462179": "Defeat monsters",
}
KOREAN = {"370026": "훈련의 날"}
SCORE = {
    "1000020101": {"name": "462179", "value": "1", "points": "300"},
    "1000020104": {"name": "370006", "value": "1", "points": "40"},
    "441000": {"name": "370006", "value": "100", "points": "10"},
    "441016": {"name": "462179", "value": "1", "points": "40000"},
}
NAMES = {"100004": "Survival Preparedness"}

PREPAREDNESS = (
    "hero.event.info.get",
    {
        "activityId": "100004",
        "eventList": [
            {
                "eventId": "10000401",
                "actName": "370026",
                "score": "1000020101|1000020104|9999999999",
            }
        ],
    },
)
DUEL = (
    "hero.event.info.get",
    {
        "activityId": "70005",
        "eventList": [
            {
                "eventId": "110033",
                "actName": "371026",
                "day": 4,
                "minDayScore": 10000,
                "minWeekScore": 100000,
                "score": "441000|441016",
            }
        ],
    },
)
# Activity 100003 as the journal shows it (2026-11-08): `score` is a threshold,
# not a list of score ids, so nothing in it scores.
THRESHOLD = (
    "hero.event.info.get",
    {"activityId": "100003", "eventList": [{"eventId": "10000307", "score": "90272"}]},
)
CALENDAR = (
    "get.hero.event.calendar",
    {
        "actTime": 240,
        "dayArr": [
            {"day": 1, "eventArr": [{"eventId": "10000401"}, {"eventId": "10000402"}]},
            {"day": 2, "eventArr": [{"eventId": "10000402"}]},
        ],
    },
)


def guide(*observations: tuple[str, dict[str, Any]], names: dict[str, str] | None = None) -> Guide:
    return build_from(ENGLISH, KOREAN, SCORE, observations, names)


def test_a_theme_lists_what_scores_with_the_base_value() -> None:
    built = guide(PREPAREDNESS)

    (theme,) = built.themes
    assert (theme["activity_id"], theme["event_id"], theme["name"]) == (
        "100004",
        "10000401",
        "Training Day",
    )
    assert theme["name_ko"] == "훈련의 날"
    assert [(s["action"], s["points"], s["per_value"]) for s in built.scores] == [
        ("Defeat monsters", 300, 1),
        ("Gather resources", 40, 1),
    ]


def test_a_score_id_the_table_does_not_know_is_skipped_not_guessed() -> None:
    built = guide(PREPAREDNESS)

    assert "9999999999" not in {s["score_id"] for s in built.scores}


def test_the_duel_theme_carries_its_weekday_and_the_two_scores_to_reach() -> None:
    (theme,) = guide(DUEL).themes

    assert (theme["day"], theme["min_day_score"], theme["min_week_score"]) == (4, 10000, 100000)


def test_points_per_hundred_keeps_its_unit() -> None:
    scores = {s["score_id"]: s for s in guide(DUEL).scores}

    assert (scores["441000"]["per_value"], scores["441000"]["points"]) == (100, 10)


def test_the_calendar_takes_its_activity_from_the_theme_that_owns_the_event() -> None:
    built = guide(PREPAREDNESS, CALENDAR)

    assert [(c["activity_id"], c["day"], c["slot"], c["event_id"]) for c in built.calendar] == [
        ("100004", 1, 1, "10000401"),
    ]


def test_a_calendar_event_no_theme_claims_is_dropped() -> None:
    built = guide(CALENDAR)

    assert built.calendar == []


def test_the_newest_capture_wins_for_a_theme_seen_twice() -> None:
    older = (
        "hero.event.info.get",
        {"activityId": "100004", "eventList": [{"eventId": "10000401", "actName": "371026"}]},
    )
    (theme,) = guide(PREPAREDNESS, older).themes

    assert theme["name"] == "Training Day"


def test_other_commands_are_ignored_and_other_activities_are_kept() -> None:
    other = ("hero.event.info.get", {"activityId": "100009", "eventList": [{"eventId": "1"}]})
    unrelated = ("get.something.else", {"activityId": "100004"})

    built = guide(other, unrelated)

    assert [t["activity_id"] for t in built.themes] == ["100009"]
    assert built.activities == ["100009"]


def test_the_activity_filter_is_gone() -> None:
    assert not hasattr(event_guide, "ACTIVITIES")


def test_every_activity_seen_is_counted_and_a_scoreless_one_gets_no_guide() -> None:
    built = guide(PREPAREDNESS, DUEL, THRESHOLD, names=NAMES)

    assert built.activities == ["100003", "100004", "70005"]
    assert built.scoreless == ["100003"]
    assert [(g["activity_id"], g["slug"], g["title"], g["published"]) for g in built.guides] == [
        ("100004", "activity-100004", "Survival Preparedness", False),
        ("70005", "activity-70005", "Activity 70005", False),
    ]
    assert built.unnamed == ["70005"]


def test_a_client_point_table_section_per_theme() -> None:
    built = guide(PREPAREDNESS, DUEL, names=NAMES)

    duel = next(s for s in built.sections if s["activity_id"] == "70005")
    assert (duel["kind"], duel["source"], duel["title"], duel["sort_order"]) == (
        "point_table",
        "client",
        "Showdown",
        4,
    )
    assert duel["payload"]["day"] == 4
    assert duel["payload"]["theme"] == "Showdown"
    assert duel["payload"]["rows"][0] == {
        "score_id": "441000",
        "action": "Gather resources",
        "points": 10,
        "per": 100,
    }
    survival = next(s for s in built.sections if s["activity_id"] == "100004")
    assert survival["payload"]["day"] is None
    assert [r["score_id"] for r in survival["payload"]["rows"]] == ["1000020101", "1000020104"]


def test_the_dry_run_line_names_what_the_operator_needs() -> None:
    line = dry_run_report(guide(PREPAREDNESS, DUEL, THRESHOLD, CALENDAR, names=NAMES))

    assert line == (
        "activities=3 themes=3 scores=4 calendar=1 guides=2 sections=2"
        " scoreless=[100003] unnamed=[70005]"
    )


def _journal(path: Path, rows: list[tuple[str, str, dict[str, Any]]]) -> None:
    db = sqlite3.connect(path)
    db.execute(
        "create table raw_observations (observation_id text primary key,"
        " collector_id text not null, source_command text not null, captured_at text not null,"
        " collected_from_server_id integer not null, payload_json text not null,"
        " created_at text not null)"
    )
    for n, (captured_at, command, payload) in enumerate(rows):
        db.execute(
            "insert into raw_observations values (?, 'c', ?, ?, 580, ?, ?)",
            (f"o{n}", command, captured_at, json.dumps(payload), captured_at),
        )
    db.commit()
    db.close()


def test_the_journal_feeds_the_same_guide(tmp_path: Path) -> None:
    path = tmp_path / "journal.db"
    _journal(
        path,
        [
            ("2026-11-01T00:00:00Z", *DUEL),
            ("2026-11-02T00:00:00Z", *PREPAREDNESS),
            ("2026-11-03T00:00:00Z", *THRESHOLD),
            ("2026-11-04T00:00:00Z", *CALENDAR),
            ("2026-11-05T00:00:00Z", "get.something.else", {"activityId": "1"}),
        ],
    )

    observations = read_journal(str(path))
    built = build_from(ENGLISH, KOREAN, SCORE, observations, NAMES)

    assert [o[0] for o in observations][:2] == ["get.hero.event.calendar", "hero.event.info.get"]
    expected = guide(PREPAREDNESS, DUEL, THRESHOLD, CALENDAR, names=NAMES)
    assert dry_run_report(built) == dry_run_report(expected)


def test_write_guides_adds_missing_guides_and_replaces_only_client_sections() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json=[
                    {"guide_id": "g-100004", "activity_id": "100004"},
                    {"guide_id": "g-70005", "activity_id": "70005"},
                ],
            )
        return httpx.Response(201)

    built = guide(PREPAREDNESS, DUEL, names=NAMES)
    with httpx.Client(base_url="http://db", transport=httpx.MockTransport(handle)) as client:
        inserted, written = write_guides(client, built)

    assert (inserted, written) == (2, 2)
    post_guides, get_guides, delete_sections, post_sections = requests
    assert post_guides.url.path == "/rest/v1/event_guides"
    assert "ignore-duplicates" in post_guides.headers["Prefer"]
    assert post_guides.url.params["on_conflict"] == "activity_id"
    assert get_guides.url.path == "/rest/v1/event_guides"
    assert delete_sections.method == "DELETE"
    assert delete_sections.url.params["source"] == "eq.client"
    assert delete_sections.url.params["guide_id"] == "in.(g-100004,g-70005)"
    sections = json.loads(post_sections.content)
    assert {s["guide_id"] for s in sections} == {"g-100004", "g-70005"}
    assert all("activity_id" not in s for s in sections)


def test_write_guides_with_nothing_to_write_touches_nothing() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"unexpected request {request.method} {request.url}")

    with httpx.Client(base_url="http://db", transport=httpx.MockTransport(handle)) as client:
        assert write_guides(client, guide(THRESHOLD)) == (0, 0)
