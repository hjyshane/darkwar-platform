"""Large Treasure Spots to Discord (0315): what is said, when, and what stops a repeat.

The things that fail silently here: a key that moves with a lantern's state
posts the same list every five minutes; a key that ignores the channel
silences the second room; a message off-season announces a list that means
something else; and a coordinate in our tile form sends a member one square
off from the lantern.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx

from dw_collector.notify.compose import treasure_message
from dw_collector.notify.worker import TREASURE_SEASON_ID, NotifyConfig, NotifyWorker, Row

NOW = datetime(2026, 11, 10, 1, 10, 26, tzinfo=UTC)
ROUTING: dict[str, Row] = {"treasure_spots": {"enabled": True, "channel": "season4"}}


def _site(**overrides: object) -> Row:
    row: Row = {
        "server_id": 580,
        "game_x": 453,
        "game_y": 275,
        "status": 3,
        "expires_at": "2026-11-10T02:25:00+00:00",
        "revealed_at": None,
        "limit_seconds": None,
        "participant_count": 0,
    }
    row.update(overrides)
    return row


def test_the_list_is_the_games_own_coordinates_in_share_form() -> None:
    message = treasure_message(channel="season4", server_id=580, sites=[_site()], now=NOW)

    assert message is not None
    assert message.event == "treasure_spots"
    assert message.title == "Large Treasure Spots · #580 · 1"
    assert "`#580[X:453 Y:275]` · unlit lantern · 1h 14m left" in message.body


def test_an_open_spot_says_so_and_counts_down_its_hour_not_the_expiry() -> None:
    opened = _site(
        game_x=456,
        game_y=261,
        status=2,
        revealed_at="2026-11-10T00:41:14+00:00",
        limit_seconds=3600,
        participant_count=3,
    )
    message = treasure_message(channel="season4", server_id=580, sites=[opened], now=NOW)

    assert message is not None
    assert "`#580[X:456 Y:261]` · open · 3 exploring · 30m left" in message.body


def test_unlit_lanterns_are_listed_before_open_spots() -> None:
    opened = _site(game_x=456, game_y=261, status=2)
    message = treasure_message(channel="season4", server_id=580, sites=[opened, _site()], now=NOW)

    assert message is not None
    assert message.body.index("X:453") < message.body.index("X:456")


def test_the_key_moves_with_the_places_not_with_their_state() -> None:
    before = treasure_message(channel="season4", server_id=580, sites=[_site()], now=NOW)
    lit = treasure_message(
        channel="season4", server_id=580, sites=[_site(status=0)], now=NOW + timedelta(minutes=5)
    )
    reordered = treasure_message(
        channel="season4",
        server_id=580,
        sites=[_site(game_x=456, game_y=261), _site()],
        now=NOW,
    )
    ordered = treasure_message(
        channel="season4",
        server_id=580,
        sites=[_site(), _site(game_x=456, game_y=261)],
        now=NOW,
    )
    other_room = treasure_message(channel="general", server_id=580, sites=[_site()], now=NOW)

    assert before is not None and lit is not None and other_room is not None
    assert before.idempotency_key == lit.idempotency_key
    assert reordered is not None and ordered is not None
    assert reordered.idempotency_key == ordered.idempotency_key
    assert reordered.idempotency_key != before.idempotency_key
    assert other_room.idempotency_key != before.idempotency_key


def test_nothing_standing_is_not_a_message() -> None:
    assert treasure_message(channel="season4", server_id=580, sites=[], now=NOW) is None


def _worker(answers: dict[str, list[Row]], seen: list[str] | None = None) -> NotifyWorker:
    """A worker whose Supabase answers by table name, so the two reads differ."""

    def handler(request: httpx.Request) -> httpx.Response:
        table = request.url.path.rsplit("/", 1)[-1]
        if seen is not None:
            seen.append(table)
        return httpx.Response(200, json=answers.get(table, []))

    worker = NotifyWorker(NotifyConfig(supabase_url="http://supabase.test", secret_key="k"))
    worker.client.close()
    worker.client = httpx.Client(transport=httpx.MockTransport(handler))
    return worker


def _season(season_id: int, ends_at: str | None = None) -> Row:
    return {"season_id": season_id, "starts_at": "2026-11-09T02:00:00+00:00", "ends_at": ends_at}


def test_nothing_is_fetched_when_the_event_is_off() -> None:
    seen: list[str] = []
    worker = _worker({"seasons": [_season(TREASURE_SEASON_ID)]}, seen)

    assert worker.treasure_candidates({"treasure_spots": {"enabled": False}}) == []
    assert seen == []


def test_off_season_the_sites_are_not_even_asked_for() -> None:
    seen: list[str] = []
    worker = _worker(
        {"seasons": [_season(TREASURE_SEASON_ID - 1)], "season_sites_live": [_site()]}, seen
    )

    assert worker.treasure_candidates(ROUTING) == []
    assert seen == ["seasons"]


def test_a_season_that_has_ended_counts_as_off_season() -> None:
    worker = _worker(
        {
            "seasons": [_season(TREASURE_SEASON_ID, ends_at="2026-11-01T02:00:00+00:00")],
            "season_sites_live": [_site()],
        }
    )

    assert worker.treasure_candidates(ROUTING) == []


def test_in_season_each_server_gets_its_own_list() -> None:
    worker = _worker(
        {
            "seasons": [_season(TREASURE_SEASON_ID)],
            "season_sites_live": [
                _site(),
                _site(server_id=581, game_x=100, game_y=100),
                _site(game_x=456, game_y=261, status=2),
            ],
        }
    )

    messages = worker.treasure_candidates(ROUTING)

    assert [(m.channel, m.title) for m in messages] == [
        ("season4", "Large Treasure Spots · #580 · 2"),
        ("season4", "Large Treasure Spots · #581 · 1"),
    ]
    assert all(m.event == "treasure_spots" for m in messages)


def test_a_row_without_a_game_coordinate_is_left_out_not_guessed() -> None:
    message = treasure_message(
        channel="season4", server_id=580, sites=[_site(game_x=None)], now=NOW
    )

    assert message is None
