"""exchange.info and user.get.shop.info — packs and shop entries (0215),
and the item valuation that prices them."""

from __future__ import annotations

from dw_collector import registry
from dw_collector.gamedata.values import Pack, estimate
from dw_collector.normalize import shop
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("exchange.info") is shop.normalize_packs
    assert registry.get("user.get.shop.info") is shop.normalize_listings


def _packs(observation):  # type: ignore[no-untyped-def]
    return [r for r in shop.normalize_packs(observation) if r.target_table == "shop_pack_snapshots"]


def test_a_pack_keeps_its_price_rubies_contents_and_window() -> None:
    rows = _packs(load_observation("exchange.info/packs_v1.json"))
    pack = rows[0].row

    assert pack["pack_id"] == "240806011"
    assert pack["dollars"] == 4.99
    assert pack["rubies"] == 500
    assert pack["claimed_percent"] == 1200
    assert pack["items"] == [
        {"id": "230110", "qty": 10},
        {"id": "210892", "qty": 100},
        {"id": "222003", "qty": 5},
    ]
    assert pack["starts_at"] == "2026-09-27T02:00:00+00:00"
    assert pack["name_key"] == "321400"


def test_rubies_given_as_a_resource_count_as_rubies() -> None:
    """Resource 15 is Ruby; resource 13 is not."""
    rows = _packs(load_observation("exchange.info/packs_v1.json"))

    assert rows[1].row["rubies"] == 200
    assert rows[1].row["items"] == []


def test_a_pack_without_a_price_or_a_numeric_id_is_skipped() -> None:
    rows = _packs(load_observation("exchange.info/packs_v1.json"))

    assert [r.row["pack_id"] for r in rows] == ["240806011", "9001"]


def test_buying_a_pack_does_not_make_it_a_new_pack() -> None:
    """bought / buy counts are the account's, not the offer's."""
    first = load_observation("exchange.info/packs_v1.json")
    bought = first.model_copy(deep=True)
    bought.payload["exchange"][0]["bought"] = True
    bought.payload["exchange"][1]["buy_times"] = 2

    keys = [r.idempotency_key for r in _packs(first)]
    assert keys == [r.idempotency_key for r in _packs(bought)]
    assert "bought" not in _packs(first)[0].row["raw"]


def test_shop_listings_carry_type_item_price_and_discount() -> None:
    rows = shop.normalize_listings(load_observation("user.get.shop.info/ruby_shop_v1.json"))

    assert [
        (r.row["listing_id"], r.row["item_id"], r.row["qty"], r.row["price"]) for r in rows
    ] == [
        ("100001", "230100", 1, 400),
        ("100002", "230101", 20, 80),
        ("100003", None, 1, 300),
    ]
    assert {r.row["shop_type"] for r in rows} == {3}
    assert rows[1].row["discount"] == 80.0
    assert (rows[0].row["currency_kind"], rows[0].row["currency_id"]) == (1, "15")


def test_a_listing_without_a_price_is_skipped() -> None:
    rows = shop.normalize_listings(load_observation("user.get.shop.info/ruby_shop_v1.json"))

    assert "100004" not in [r.row["listing_id"] for r in rows]


def test_an_answer_without_a_shop_type_writes_nothing() -> None:
    observation = load_observation("user.get.shop.info/ruby_shop_v1.json")
    observation.payload.pop("type")

    assert shop.normalize_listings(observation) == []


def test_estimate_recovers_an_item_from_the_packs_it_is_in() -> None:
    """Two packs that hold a game-priced item (100 rubies) and an unknown one
    worth 50: the claims are exactly consistent, so the fit is exact."""
    known = {"1": 100.0}
    packs = [
        # claimed = 1000% of $0.99 = 1000 rubies = 100 ruby + 4x100 + 10x50
        Pack(dollars=0.99, rubies=100, claimed_percent=1000, items=(("1", 4), ("2", 10))),
        # 600 rubies = 0 + 1x100 + 10x50
        Pack(dollars=0.99, rubies=0, claimed_percent=600, items=(("1", 1), ("2", 10))),
    ]

    assert estimate(packs, known) == {"2": 50.0}


def test_an_item_seen_in_one_pack_is_not_estimated() -> None:
    packs = [Pack(dollars=0.99, rubies=0, claimed_percent=500, items=(("9", 1),))]

    assert estimate(packs, {}) == {}


def test_a_standing_pack_far_in_the_future_does_not_break_the_read() -> None:
    observation = load_observation("exchange.info/packs_v1.json")
    observation.payload["exchange"][0]["end"] = 4102444800000000  # year ~132,000

    assert shop.normalize_packs(observation)[0].row["ends_at"] is None


def test_copies_of_one_pack_do_not_estimate_the_item_unique_to_them() -> None:
    """Five copies of one composition give one claim, not five: the item only
    they hold would take all of it (Land Expansion, 2026-10-03)."""
    known = {"1": 100.0}
    copies = [
        Pack(dollars=4.99, rubies=500, claimed_percent=8000, items=(("1", 10), ("land", 5)))
        for _ in range(5)
    ]

    assert estimate(copies, known) == {}


def test_variants_differing_only_in_a_one_off_item_are_still_copies() -> None:
    """Wartime Investment: five variants, each with Land Expansion and one item
    no other pack holds. Those packs cannot be split, so Land Expansion stays
    unvalued instead of taking the whole claim."""
    known = {"1": 100.0}
    variants = [
        Pack(
            dollars=4.99,
            rubies=500,
            claimed_percent=8000,
            items=(("1", 10), ("land", 5), (f"oneoff{i}", 1)),
        )
        for i in range(5)
    ]
    # A real two-composition item alongside, to show the rest still solves.
    variants += [
        Pack(dollars=0.99, rubies=100, claimed_percent=1000, items=(("1", 4), ("2", 10))),
        Pack(dollars=0.99, rubies=0, claimed_percent=600, items=(("1", 1), ("2", 10))),
    ]

    assert estimate(variants, known) == {"2": 50.0}


def test_each_capture_records_which_packs_it_listed() -> None:
    """The catalog row is what the server offers now; pack rows cannot say,
    since an unchanged pack is never written again."""
    observation = load_observation("exchange.info/packs_v1.json")
    (catalog,) = [
        r for r in shop.normalize_packs(observation) if r.target_table == "shop_pack_catalogs"
    ]

    assert catalog.row["pack_ids"] == ["9001", "240806011"]
    assert catalog.row["server_id"] == observation.collected_from_server_id
    # A later capture of the same list is a new row: it moves "now" forward.
    later = observation.model_copy(
        update={"captured_at": observation.captured_at.replace(minute=59)}
    )
    (again,) = [r for r in shop.normalize_packs(later) if r.target_table == "shop_pack_catalogs"]
    assert again.idempotency_key != catalog.idempotency_key


def test_a_capture_with_no_packs_records_no_catalog() -> None:
    observation = load_observation("exchange.info/packs_v1.json")
    empty = observation.model_copy(update={"payload": {"exchange": []}})

    assert shop.normalize_packs(empty) == []
