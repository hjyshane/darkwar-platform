"""What the notice event asks Supabase for, and when it decides a notice is news.

The collector runs with the service key, and the service key bypasses RLS. On this
path the QUERY is the access control: the `published_at` policies added in 0108
stop a member reading somebody's draft on the board, and stop nothing at all here.
A filter missing from `notice_candidates` does not raise — it posts a half-written
notice to the whole alliance, which is the failure the draft feature exists to
prevent.

`live_at` is the other thing worth pinning. It decides the outbox key, so getting
it wrong either announces the same notice twice or silently announces nothing.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx

from dw_collector.notify.worker import NotifyConfig, NotifyWorker, Row

ROUTING: dict[str, Row] = {"notices": {"enabled": True, "channel": "general"}}


def _worker(rows: list[Row], seen: list[httpx.QueryParams] | None = None) -> NotifyWorker:
    """A worker whose Supabase is a canned answer.

    The client is swapped rather than injected because `NotifyWorker` builds its
    own — worth knowing, but not worth widening the constructor for one test.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request.url.params)
        return httpx.Response(200, json=rows)

    worker = NotifyWorker(NotifyConfig(supabase_url="http://supabase.test", secret_key="k"))
    worker.client.close()
    worker.client = httpx.Client(transport=httpx.MockTransport(handler))
    return worker


def _ago(days: float) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat()


def _notice(**overrides: object) -> Row:
    row: Row = {
        "announcement_id": "n1",
        "title": "Bear hunt",
        "body": "Gather at 20:00 UTC.",
        "starts_at": None,
        "ends_at": None,
        "published_at": _ago(0),
    }
    row.update(overrides)
    return row


def _guide(**overrides: object) -> Row:
    row: Row = {
        "guide_id": "g1",
        "title": "Bear hunt",
        "body": "Gather at 20:00 UTC.",
        "category": "tip",
        "published_at": _ago(0),
    }
    row.update(overrides)
    return row


def test_a_draft_is_never_even_asked_for() -> None:
    seen: list[httpx.QueryParams] = []
    _worker([], seen).notice_candidates(ROUTING)
    assert seen[0].get("published_at") == "not.is.null"


def test_a_notice_held_as_a_draft_is_news_when_it_is_published() -> None:
    """The reason `live_at` stopped falling back to `created_at`.

    Somebody opens Saturday's plan a fortnight early and leaves it unfinished.
    Publishing it has to reach the channel — and it is news on the day it was
    published, not on the day the box was first typed into, which is well outside
    the seven-day backlog window and would have been dropped without a word.
    """
    published = _ago(0)
    messages = _worker([_notice(published_at=published)]).notice_candidates(ROUTING)
    assert [m.idempotency_key for m in messages] == [f"notice:n1:{published}:general"]


def test_a_notice_published_in_advance_is_news_on_the_day_it_starts() -> None:
    """The other half of "whichever came last".

    A notice written and published on Monday for a Saturday event is not news on
    Monday — the channel would disagree with the dashboard about when the thing
    happens. Once Saturday arrives the start is the later of the two, and that is
    the moment the key records.
    """
    starts = _ago(1)
    messages = _worker([_notice(starts_at=starts, published_at=_ago(5))]).notice_candidates(ROUTING)
    assert [m.idempotency_key for m in messages] == [f"notice:n1:{starts}:general"]


def test_a_notice_that_went_live_before_the_window_is_left_alone() -> None:
    """NOTICE_BACKLOG, still doing its job.

    Switching the event on must not empty a season of standing notices into the
    channel. This is the assertion that stops the fix above from turning into
    that, because both bugs live in the same expression.
    """
    assert _worker([_notice(published_at=_ago(30))]).notice_candidates(ROUTING) == []


def test_nothing_is_fetched_when_the_event_is_switched_off() -> None:
    seen: list[httpx.QueryParams] = []
    assert _worker([_notice()], seen).notice_candidates({}) == []
    assert seen == []


GUIDES_ON: dict[str, Row] = {"guides": {"enabled": True, "channel": "general"}}


def test_a_guide_draft_is_never_even_asked_for() -> None:
    seen: list[httpx.QueryParams] = []
    _worker([], seen).guide_candidates(GUIDES_ON)
    assert "not.is.null" in seen[0].get_list("published_at")


def test_the_whole_guide_board_is_not_announced_on_the_first_pass() -> None:
    """`GUIDE_BACKLOG`, which the notice side carried from the start and this
    did not.

    `dw-notify` was never registered as a scheduled task, so the outbox sat empty
    while the board filled up. `enqueue` dedupes against that outbox, so with no
    window the first pass would treat the twenty most recently published guides
    as new and post all twenty at once — on whatever day somebody finally
    scheduled the task.

    Asserted on the QUERY rather than on the returned messages: the window is a
    server-side filter, so a fake that answers with whatever rows it was handed
    cannot show it working. The cutoff is checked loosely on purpose — this is
    pinning "about a week", not the clock.
    """
    seen: list[httpx.QueryParams] = []
    _worker([], seen).guide_candidates(GUIDES_ON)
    window = [value for value in seen[0].get_list("published_at") if value.startswith("gte.")]
    assert len(window) == 1
    cutoff = datetime.fromisoformat(window[0].removeprefix("gte."))
    assert timedelta(days=6) < datetime.now(UTC) - cutoff < timedelta(days=8)


# ------------------------------------------------------------- 0133: two rooms


def test_a_notice_naming_two_channels_is_two_messages() -> None:
    """One post, one message per room.

    The keys must DIFFER, and that is the assertion that matters rather than the
    count: `enqueue` dedupes on the key with `resolution=ignore-duplicates`, so
    two messages sharing one key is not two posts with a tidy-up — it is the
    second room silently never hearing anything, with nothing in the log to say
    so.
    """
    messages = _worker([_notice(channels=["war", "general"])]).notice_candidates(ROUTING)
    assert [m.channel for m in messages] == ["war", "general"]
    assert len({m.idempotency_key for m in messages}) == 2


def test_a_notice_naming_no_channel_still_goes_to_the_settings_one() -> None:
    """Null is "wherever notices normally go", not "nowhere".

    Both the missing key and an explicit null, because PostgREST omits neither
    reliably and a post that announces nowhere is the failure nobody reports.
    """
    for row in (_notice(), _notice(channels=None)):
        messages = _worker([row]).notice_candidates(ROUTING)
        assert [m.channel for m in messages] == ["general"]


def test_the_same_room_named_twice_is_announced_once() -> None:
    """0133's trigger de-duplicates on the way in; this is the belt for a row
    written before it existed. Two identical messages in one channel is the
    outbox's whole reason for being."""
    messages = _worker([_guide(channels=["war", "war"])]).guide_candidates(GUIDES_ON)
    assert [m.channel for m in messages] == ["war"]
