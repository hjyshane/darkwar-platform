"""Each alliance's posts go to that alliance's Discord (0199).

The primary's routing is the `app_settings` blob the worker always read. Any
other own alliance's is its own row in `alliance_settings`, and it is NOT
inherited: an alliance with no routing of its own sends nothing, rather than
into the primary's rooms. These pin that, and the two ways it could fail
quietly — a guess before the routing has loaded, and the primary's key changing
so that a period already announced is announced again.
"""

from __future__ import annotations

from datetime import UTC, datetime

import httpx

from dw_collector.notify.compose import rank_period_message
from dw_collector.notify.worker import NotifyConfig, NotifyWorker, Row, first_pinned

ALPHA = "00000000-0000-4000-8000-00000000a001"
BRAVO = "00000000-0000-4000-8000-00000000b002"
CHARLIE = "00000000-0000-4000-8000-00000000c003"

PRIMARY_ROUTING: dict[str, Row] = {"notices": {"enabled": True, "channel": "alpha-news"}}


def _notice(announcement_id: str, alliance_id: str | None) -> Row:
    return {
        "announcement_id": announcement_id,
        "title": "Bear hunt",
        "body": "Gather at 20:00 UTC.",
        "starts_at": None,
        "ends_at": None,
        "published_at": datetime.now(UTC).isoformat(),
        "channels": None,
        "alliance_id": alliance_id,
    }


def _worker(by_table: dict[str, list[Row]]) -> NotifyWorker:
    """Supabase answering by table name, the part of the path before '?'."""

    def handler(request: httpx.Request) -> httpx.Response:
        table = request.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, json=by_table.get(table, []))

    worker = NotifyWorker(NotifyConfig(supabase_url="http://supabase.test", secret_key="k"))
    worker.client.close()
    worker.client = httpx.Client(transport=httpx.MockTransport(handler))
    return worker


def _loaded(by_table: dict[str, list[Row]]) -> NotifyWorker:
    worker = _worker(
        {
            "app_settings": [{"value": {"alliance_ids": [ALPHA, BRAVO, CHARLIE]}}],
            "alliance_settings": [
                {
                    "alliance_id": BRAVO,
                    "value": {"notices": {"enabled": True, "channel": "bravo-news"}},
                },
                # Charlie is pinned and chose nothing: its routing is empty.
                {"alliance_id": CHARLIE, "value": {}},
            ],
            **by_table,
        }
    )
    worker.load_alliance_routing()
    return worker


def test_each_alliance_is_announced_in_its_own_room() -> None:
    worker = _loaded(
        {
            "announcements": [
                _notice("n-alpha", ALPHA),
                _notice("n-bravo", BRAVO),
                _notice("n-charlie", CHARLIE),
            ]
        }
    )
    sent = {
        m.idempotency_key.split(":")[1]: m.channel
        for m in worker.notice_candidates(PRIMARY_ROUTING)
    }

    assert sent == {"n-alpha": "alpha-news", "n-bravo": "bravo-news"}


def test_an_alliance_without_routing_is_not_sent_to_the_primary() -> None:
    """The failure this whole change is about: Charlie chose no room, and the
    primary's room is not a default for it."""
    worker = _loaded({"announcements": [_notice("n-charlie", CHARLIE)]})

    assert worker.notice_candidates(PRIMARY_ROUTING) == []


def test_another_alliance_is_fetched_for_even_when_the_primary_is_off() -> None:
    worker = _loaded({"announcements": [_notice("n-bravo", BRAVO)]})

    [message] = worker.notice_candidates({})
    assert message.channel == "bravo-news"


def test_before_the_routing_loads_nothing_that_names_an_alliance_is_routed() -> None:
    """A skipped pass costs one pass; a guess costs a message in the other
    alliance's Discord."""
    worker = _worker({"announcements": [_notice("n-bravo", BRAVO), _notice("n-old", None)]})

    sent = [m.idempotency_key.split(":")[1] for m in worker.notice_candidates(PRIMARY_ROUTING)]

    assert sent == ["n-old"]


def test_an_install_with_nothing_pinned_routes_everything_the_old_way() -> None:
    worker = _worker({"announcements": [_notice("n-1", ALPHA)]})
    worker.load_alliance_routing()  # no pin, no per-alliance rows

    [message] = worker.notice_candidates(PRIMARY_ROUTING)
    assert message.channel == "alpha-news"


def test_the_primary_is_read_from_either_shape_of_the_pin() -> None:
    assert first_pinned({"alliance_ids": [BRAVO, ALPHA]}) == BRAVO
    assert first_pinned({"alliance_id": ALPHA}) == ALPHA
    assert first_pinned(None) is None
    assert first_pinned({"alliance_ids": []}) is None


def test_the_primarys_rank_period_key_is_unchanged() -> None:
    """Changing it would announce every period already announced, again."""
    common = {
        "channel": "reports",
        "period_start": "2026-09-14T02:00:00+00:00",
        "period_end": "2026-09-28T02:00:00+00:00",
        "scoring_version": 8,
        "rows": [],
    }
    primary = rank_period_message(**common)  # type: ignore[arg-type]
    other = rank_period_message(**common, alliance_key=BRAVO)  # type: ignore[arg-type]

    assert primary.idempotency_key == "rank_period:2026-09-14:8"
    assert other.idempotency_key == f"rank_period:2026-09-14:8:{BRAVO}"
