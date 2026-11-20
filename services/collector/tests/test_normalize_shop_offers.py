"""The selling screens' answers → shop_pack_offers (0337): which packs this
account is sold, and what the passes whose pack lists nothing pay."""

from __future__ import annotations

from datetime import timedelta

import pytest

from dw_collector import registry
from dw_collector.normalize import shop_offers
from tests.conftest import load_observation

COMMANDS = {
    "get.battlepass.info": shop_offers.normalize_battlepass,
    "get.season.battlepass.info": shop_offers.normalize_season_battlepass,
    "growth.plan.info": shop_offers.normalize_growth_plan,
    "get.month.detect.card": shop_offers.normalize_month_detect_card,
    "get.week.card.info": shop_offers.normalize_week_cards,
    "get.season.week.card.info": shop_offers.normalize_season_week_card,
    "multi.choice.gift.info": shop_offers.normalize_multi_choice_gift,
    "get.custom.package.activity.info": shop_offers.normalize_custom_package_activity,
    "get.month.pay.act.info": shop_offers.normalize_month_pay,
}

FIXTURES = [
    "get.battlepass.info/two_pack_pass_v1.json",
    "get.battlepass.info/series_pass_v1.json",
    "get.season.battlepass.info/season_pass_v1.json",
    "growth.plan.info/growth_plan_v1.json",
    "get.month.detect.card/radar_card_v1.json",
    "get.week.card.info/week_cards_v1.json",
    "get.season.week.card.info/season_week_card_v1.json",
    "multi.choice.gift.info/gifts_v1.json",
    "get.custom.package.activity.info/daily_deals_v1.json",
    "get.month.pay.act.info/month_pay_v1.json",
]


def _rows(relative: str):  # type: ignore[no-untyped-def]
    observation = load_observation(relative)
    return COMMANDS[observation.source_command](observation)


def _by_pack(relative: str) -> dict[str, dict]:  # type: ignore[type-arg]
    return {r.row["pack_id"]: r.row for r in _rows(relative)}


def test_registered() -> None:
    for command, fn in COMMANDS.items():
        assert registry.get(command) is fn


@pytest.mark.parametrize("relative", FIXTURES)
def test_every_row_is_an_offer_with_its_own_key(relative: str) -> None:
    rows = _rows(relative)

    assert rows
    assert {r.target_table for r in rows} == {"shop_pack_offers"}
    assert len({r.idempotency_key for r in rows}) == len(rows)
    for r in rows:
        assert r.row["pack_id"].isdigit()
        assert r.row["server_id"] == 580
        assert r.row["parser_version"] == shop_offers.PARSER_VERSION


def test_a_two_pack_pass_gives_each_pack_its_own_track() -> None:
    """exchangeId unlocks the special track, extExchangeId the middle one;
    contents are the track summed over the levels."""
    packs = _by_pack("get.battlepass.info/two_pack_pass_v1.json")

    assert set(packs) == {"26011902", "26011901"}
    special = packs["26011902"]
    assert special["track"] == "special"
    assert special["activity_id"] == "2666671"
    assert special["levels"] == 4
    assert {"id": "310010", "qty": 1} in special["items"]
    middle = packs["26011901"]
    assert middle["track"] == "middle"
    assert {"id": "310009", "qty": 1} in middle["items"]
    # The free track belongs to neither pack.
    assert all(item["id"] != "252016" for item in special["items"] + middle["items"])


def test_a_series_pass_names_every_series_pack() -> None:
    packs = _by_pack("get.battlepass.info/series_pass_v1.json")

    assert set(packs) == {"310000026", "310000027", "310000028"}
    assert {p["track"] for p in packs.values()} == {"special"}
    assert packs["310000026"]["items"] == packs["310000028"]["items"]
    assert packs["310000026"]["items"]


def test_a_season_pass_matches_its_two_packs_by_position() -> None:
    packs = _by_pack("get.season.battlepass.info/season_pass_v1.json")

    assert packs["83103"]["track"] == "middle"
    assert packs["83104"]["track"] == "special"
    assert packs["83103"]["items"] and packs["83104"]["items"]


def test_a_season_pass_with_another_number_of_packs_claims_no_track() -> None:
    observation = load_observation("get.season.battlepass.info/season_pass_v1.json")
    observation.payload["packageIds"] = "83103;83104;83105"

    rows = shop_offers.normalize_season_battlepass(observation)

    assert [r.row["pack_id"] for r in rows] == ["83103", "83104", "83105"]
    assert {r.row["track"] for r in rows} == {None}
    assert all(r.row["items"] == [] and r.row["levels"] is None for r in rows)


def test_only_item_rewards_are_counted_and_quantities_add_up() -> None:
    observation = load_observation("growth.plan.info/growth_plan_v1.json")
    observation.payload["stageInfo"] = [
        {
            "specialReward": [
                {"type": 7, "value": {"id": "200366", "num": 10}},
                {"type": 0, "value": 60000},
                {"type": 7, "value": {"id": "200366", "num": 5}},
                {"type": 7, "value": {"id": "x", "num": 5}},
                {"type": 7, "value": {"id": "230101", "num": "many"}},
            ]
        },
        {"specialReward": [{"type": 7, "value": {"id": "230101", "num": 100}}]},
        "not a stage",
        {"normalReward": [{"type": 7, "value": {"id": "999", "num": 1}}]},
    ]

    (row,) = shop_offers.normalize_growth_plan(observation)

    assert row.row["items"] == [{"id": "200366", "qty": 15}, {"id": "230101", "qty": 100}]
    assert row.row["levels"] == 2
    assert row.row["activity_id"] is None


def test_a_radar_card_pays_its_paid_rewards() -> None:
    packs = _by_pack("get.month.detect.card/radar_card_v1.json")

    assert set(packs) == {"240000007"}
    assert packs["240000007"]["track"] == "paid"
    assert {"id": "253042", "qty": 20} in packs["240000007"]["items"]


def test_cards_and_gifts_are_named_without_contents() -> None:
    """Their packs list their own contents; the row only says "sold here"."""
    week = _by_pack("get.week.card.info/week_cards_v1.json")
    assert "83009" in week and "26072305" in week
    assert all(p["items"] == [] and p["track"] is None for p in week.values())

    assert set(_by_pack("get.season.week.card.info/season_week_card_v1.json")) == {"83109"}
    assert set(_by_pack("multi.choice.gift.info/gifts_v1.json")) == {
        "26032445",
        "26032455",
        "26032450",
    }
    assert set(_by_pack("get.custom.package.activity.info/daily_deals_v1.json")) == {
        "302016",
        "302017",
        "302018",
        "302019",
        "302020",
    }


def test_month_pay_names_its_packs_and_claims_no_contents() -> None:
    packs = _by_pack("get.month.pay.act.info/month_pay_v1.json")

    assert set(packs) == {"80983", "80969"}
    assert all(p["items"] == [] and p["track"] is None for p in packs.values())


@pytest.mark.parametrize("relative", FIXTURES)
def test_missing_or_malformed_fields_yield_no_rows(relative: str) -> None:
    observation = load_observation(relative)
    fn = COMMANDS[observation.source_command]

    assert fn(observation.model_copy(update={"payload": {"_id": 1, "_time": 0}})) == []

    malformed = {
        "exchangeId": "",
        "extExchangeId": None,
        "seriesExchangeIds": "310000026",
        "packageIds": 83103,
        "exchangeIds": ["302016"],
        "monthDetectCards": [None, {"exchangeId": "abc"}],
        "weekCards": {"exchange_id": "83009"},
        "gifts": [7, {"exchangeId": True}],
        "para2": "",
        "para3": {},
        "stateInfo": "nope",
    }
    assert fn(observation.model_copy(update={"payload": malformed})) == []


@pytest.mark.parametrize("relative", FIXTURES)
def test_progress_and_a_later_read_the_same_day_do_not_make_new_rows(relative: str) -> None:
    """Level, claimed states and tasks are the account's, not the offer's."""
    first = load_observation(relative)
    fn = COMMANDS[first.source_command]
    later = first.model_copy(
        deep=True, update={"captured_at": first.captured_at + timedelta(minutes=20)}
    )
    later.payload["_id"] = 9999
    later.payload["battlePass"] = {"level": 30, "unlock": 1}
    later.payload["taskArr"] = []
    for level in later.payload.get("stateInfo") or []:
        level["normalState"] = 2
        level["specialState"] = 1

    assert [r.idempotency_key for r in fn(first)] == [r.idempotency_key for r in fn(later)]


def test_the_next_day_writes_the_offer_again() -> None:
    """The day a pack stops being written is the day it stopped being sold."""
    first = load_observation("get.season.week.card.info/season_week_card_v1.json")
    tomorrow = first.model_copy(update={"captured_at": first.captured_at + timedelta(days=1)})

    (a,) = shop_offers.normalize_season_week_card(first)
    (b,) = shop_offers.normalize_season_week_card(tomorrow)

    assert a.idempotency_key != b.idempotency_key


def test_changed_rewards_make_a_new_row() -> None:
    first = load_observation("growth.plan.info/growth_plan_v1.json")
    changed = first.model_copy(deep=True)
    changed.payload["stageInfo"][0]["specialReward"][0]["value"]["num"] += 1

    (a,) = shop_offers.normalize_growth_plan(first)
    (b,) = shop_offers.normalize_growth_plan(changed)

    assert a.idempotency_key != b.idempotency_key
