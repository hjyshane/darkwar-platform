from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from dw_collector.normalize import al_rank
from dw_collector.storage.journal import Journal
from tests.conftest import load_observation


def _counts(journal: Journal) -> tuple[int, int, int]:
    def one(sql: str) -> int:
        return int(journal.conn.execute(sql).fetchone()[0])

    return (
        one("select count(*) from raw_observations"),
        one("select count(*) from normalized_rows"),
        one("select count(*) from sync_outbox"),
    )


def test_duplicate_replay_is_a_noop(journal: Journal) -> None:
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    rows = al_rank.normalize(observation)

    first = journal.record(observation, rows)
    assert first.raw_inserted and first.rows_inserted == 93 and first.rows_duplicate == 0
    assert _counts(journal) == (1, 93, 93)

    second = journal.record(observation, rows)
    assert not second.raw_inserted
    assert second.rows_inserted == 0 and second.rows_duplicate == 93
    assert _counts(journal) == (1, 93, 93)


def test_record_is_atomic(journal: Journal) -> None:
    """FR-COL-004: a failure mid-write must leave no partial observation."""
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    rows = al_rank.normalize(observation)

    # Plant an outbox row whose idempotency_key collides with row 10. The
    # normalized insert will succeed, then the outbox insert raises — the
    # whole transaction (raw + 10 preceding rows) must roll back.
    journal.conn.execute(
        "insert into sync_outbox"
        " (event_type, entity_key, payload_json, idempotency_key, created_at, next_attempt_at)"
        " values ('test', 'test', '{}', ?, '2026-01-01T00:00:00+00:00',"
        "         '2026-01-01T00:00:00+00:00')",
        (rows[10].idempotency_key,),
    )
    journal.conn.commit()

    with pytest.raises(sqlite3.IntegrityError):
        journal.record(observation, rows)

    raw, normalized, outbox = _counts(journal)
    assert (raw, normalized) == (0, 0), "partial write leaked out of the transaction"
    assert outbox == 1  # only the planted row


def test_backoff_and_dead_letter(journal: Journal) -> None:
    observation = load_observation("al.rank/roster_nulls_v1.json")
    journal.record(observation, al_rank.normalize(observation))
    now = datetime.now(tz=UTC)

    pending = journal.pending_outbox(now=now)
    assert len(pending) == 3
    ids = [item.id for item in pending]

    journal.mark_failed(ids, "boom", max_attempts=3, base_backoff=10.0, max_backoff=300.0, now=now)
    assert journal.pending_outbox(now=now) == []
    assert len(journal.pending_outbox(now=now + timedelta(seconds=11))) == 3

    journal.mark_failed(ids, "boom", max_attempts=3, base_backoff=10.0, max_backoff=300.0, now=now)
    # attempt 2 of 3: backoff doubles to 20s
    assert journal.pending_outbox(now=now + timedelta(seconds=11)) == []
    assert len(journal.pending_outbox(now=now + timedelta(seconds=21))) == 3

    journal.mark_failed(ids, "boom", max_attempts=3, base_backoff=10.0, max_backoff=300.0, now=now)
    assert journal.outbox_counts() == {"dead_letter": 3}
    assert journal.pending_outbox(now=now + timedelta(days=1)) == []


def test_mark_sent(journal: Journal) -> None:
    observation = load_observation("al.rank/roster_nulls_v1.json")
    journal.record(observation, al_rank.normalize(observation))
    ids = [item.id for item in journal.pending_outbox()]
    journal.mark_sent(ids)
    assert journal.outbox_counts() == {"sent": 3}
    assert journal.pending_outbox() == []


def test_commands_since_excludes_rows_written_before_the_boundary(journal: Journal) -> None:
    """What the UI worker's step verification rests on: only commands that
    arrived AFTER the tap count as proof the tap landed."""
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    journal.record(observation, al_rank.normalize(observation))

    written = journal.conn.execute("select created_at from raw_observations").fetchone()[0]
    stamp = datetime.fromisoformat(written)

    assert journal.commands_since(stamp - timedelta(seconds=1)) == {"al.rank"}
    assert journal.commands_since(stamp) == set()
    assert journal.commands_since(stamp + timedelta(seconds=1)) == set()
