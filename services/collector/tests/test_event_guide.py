"""What scores in Survival Preparedness and the Alliance Duel.

What this pins: the shape of the guide built from the server's theme lists and the
client's score table, with the real ids seen in the journal on 2026-10-08. The
payloads are trimmed to the fields read; no member's score is in them.
"""

from __future__ import annotations

from dw_collector.gamedata.event_guide import build_from

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


def guide(*observations):
    return build_from(ENGLISH, KOREAN, SCORE, observations)


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


def test_the_calendar_numbers_the_slots_of_each_day() -> None:
    built = guide(CALENDAR)

    assert [(c["day"], c["slot"], c["event_id"]) for c in built.calendar] == [
        (1, 1, "10000401"),
        (1, 2, "10000402"),
        (2, 1, "10000402"),
    ]


def test_the_newest_capture_wins_for_a_theme_seen_twice() -> None:
    older = (
        "hero.event.info.get",
        {"activityId": "100004", "eventList": [{"eventId": "10000401", "actName": "371026"}]},
    )
    (theme,) = guide(PREPAREDNESS, older).themes

    assert theme["name"] == "Training Day"


def test_other_activities_and_other_commands_are_ignored() -> None:
    other = ("hero.event.info.get", {"activityId": "100003", "eventList": [{"eventId": "1"}]})
    unrelated = ("get.something.else", {"activityId": "100004"})

    built = guide(other, unrelated)

    assert (built.themes, built.scores, built.calendar) == ([], [], [])
