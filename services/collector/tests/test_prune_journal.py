"""Pruning the journal, which is the only thing that ever shrinks it.

The file grows 0.92 GB a day and nothing reclaims it. That is survivable —
half a year of disk — but the reason to have a command rather than a session
of ad-hoc SQL is that the safe boundary is not obvious: the raw payload is
the one layer that cannot be rebuilt, and an observation whose rows never
reached the cloud must outlive its own retention window.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from typer.testing import CliRunner

from dw_collector.cli import app
from dw_collector.normalize import al_rank
from dw_collector.storage.journal import Journal
from tests.conftest import load_observation

runner = CliRunner()


def _load(journal: Journal, *, captured_at: datetime) -> None:
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    aged = observation.model_copy(update={"captured_at": captured_at})
    journal.record(aged, al_rank.normalize(aged))


def _ancient() -> datetime:
    return datetime.now(tz=UTC) - timedelta(days=90)


def _recent() -> datetime:
    return datetime.now(tz=UTC) - timedelta(days=1)


def test_counting_is_the_default(journal: Journal) -> None:
    """0070 chose this shape for the cloud side and the reason holds here:
    seeing the number first has already changed the plan once."""
    _load(journal, captured_at=_ancient())
    journal.mark_sent([item.id for item in journal.pending_outbox(limit=500)])

    report = journal.prune(older_than=datetime.now(tz=UTC) - timedelta(days=30))

    assert report.observations == 1
    assert report.normalized_rows == 93
    # Nothing moved.
    assert journal.conn.execute("select count(*) from raw_observations").fetchone()[0] == 1


def _age_outbox(journal: Journal, when: datetime) -> None:
    """The outbox has its own clock.

    `sync_outbox.created_at` is when the row was written, not when the packet
    was captured. On a live collector those differ by seconds and the
    distinction never shows; in a test the observation can be backdated while
    the queue entry cannot, which is what these two tests got wrong first.
    """
    journal.conn.execute("update sync_outbox set created_at = ?", (when.isoformat(),))
    journal.conn.commit()


def test_confirm_removes_the_observation_and_its_rows(journal: Journal) -> None:
    _load(journal, captured_at=_ancient())
    journal.mark_sent([item.id for item in journal.pending_outbox(limit=500)])

    journal.prune(older_than=datetime.now(tz=UTC) - timedelta(days=30), confirm=True)

    assert journal.conn.execute("select count(*) from raw_observations").fetchone()[0] == 0
    assert journal.conn.execute("select count(*) from normalized_rows").fetchone()[0] == 0
    # The delivered queue entry stays: it was WRITTEN just now, whatever the
    # age of the traffic behind it. Harmless — its payload is self-contained,
    # so `retry-outbox --already-sent` still resends it with the normalized
    # row gone.
    assert journal.outbox_counts() == {"sent": 93}


def test_recent_observations_are_left_alone(journal: Journal) -> None:
    _load(journal, captured_at=_recent())
    journal.mark_sent([item.id for item in journal.pending_outbox(limit=500)])

    report = journal.prune(older_than=datetime.now(tz=UTC) - timedelta(days=30), confirm=True)

    assert report.observations == 0
    assert journal.conn.execute("select count(*) from raw_observations").fetchone()[0] == 1


def test_an_undelivered_observation_survives_its_own_window(journal: Journal) -> None:
    """The one that matters. Deleting the raw payload of rows that never
    reached Supabase strands outbox entries whose source no longer exists —
    data that is in neither place and cannot be rebuilt. Age does not
    override that."""
    _load(journal, captured_at=_ancient())
    # Left pending: sync has not run, or has been failing.

    report = journal.prune(older_than=datetime.now(tz=UTC) - timedelta(days=30), confirm=True)

    assert report.observations == 0
    assert report.held_back == 1
    assert journal.conn.execute("select count(*) from raw_observations").fetchone()[0] == 1
    assert journal.outbox_counts() == {"pending": 93}


def test_a_dead_letter_holds_its_observation_back_too(journal: Journal) -> None:
    """A dead letter is undelivered work somebody may still fix and retry
    (§10.3). Pruning its source would decide that question for them."""
    _load(journal, captured_at=_ancient())
    ids = [item.id for item in journal.pending_outbox(limit=500)]
    journal.mark_failed(ids, "boom", max_attempts=1, base_backoff=1.0, max_backoff=1.0)
    assert journal.outbox_counts() == {"dead_letter": 93}

    report = journal.prune(older_than=datetime.now(tz=UTC) - timedelta(days=30), confirm=True)

    assert report.held_back == 1
    assert journal.conn.execute("select count(*) from raw_observations").fetchone()[0] == 1


def test_delivered_outbox_goes_even_when_its_observation_stays(journal: Journal) -> None:
    """The queue and the record are different things. A sent entry has done
    its job whatever the age of the observation behind it — and this is where
    most of the reclaimable space was: 650,661 delivered rows, 0.79 GB."""
    _load(journal, captured_at=_recent())
    journal.mark_sent([item.id for item in journal.pending_outbox(limit=500)])
    # Only the queue is old; the traffic behind it is inside the window.
    _age_outbox(journal, _ancient())

    report = journal.prune(older_than=datetime.now(tz=UTC) - timedelta(days=30), confirm=True)

    assert report.observations == 0
    assert report.delivered_outbox == 93
    assert journal.outbox_counts() == {}
    assert journal.conn.execute("select count(*) from raw_observations").fetchone()[0] == 1


def test_vacuum_is_what_gives_the_space_back(journal: Journal) -> None:
    """`delete` leaves the pages on a free list. The first manual pass found
    `freelist_count = 3` and concluded, correctly, that vacuuming alone would
    reclaim nothing — the mirror of that is that deleting alone reclaims
    nothing either."""
    _load(journal, captured_at=_ancient())
    journal.mark_sent([item.id for item in journal.pending_outbox(limit=500)])
    journal.prune(older_than=datetime.now(tz=UTC) - timedelta(days=30), confirm=True)

    assert journal.conn.execute("pragma freelist_count").fetchone()[0] > 0
    journal.vacuum()
    assert journal.conn.execute("pragma freelist_count").fetchone()[0] == 0


def test_the_command_says_what_it_did_not_do(journal: Journal) -> None:
    _load(journal, captured_at=_ancient())

    result = runner.invoke(app, ["prune-journal", "--db", str(journal.path)])

    assert result.exit_code == 0
    assert "would remove" in result.output
    assert "nothing was deleted; pass --confirm" in result.output
    # The held-back line is the outbox alarm; it must not be swallowed.
    assert "still have undelivered rows" in result.output


def test_the_command_warns_that_deleting_is_not_shrinking(journal: Journal) -> None:
    _load(journal, captured_at=_ancient())
    journal.mark_sent([item.id for item in journal.pending_outbox(limit=500)])

    result = runner.invoke(app, ["prune-journal", "--db", str(journal.path), "--confirm"])

    assert "removed: 1 observations" in result.output
    assert "the file is the same size until --vacuum" in result.output
