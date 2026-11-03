"""Collector health is derived from the journal, not asserted (FR-COL-007)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from dw_collector.normalize import al_rank
from dw_collector.storage.journal import Journal
from dw_collector.sync.heartbeat import assess, report
from tests.conftest import load_observation

NOW = datetime(2026, 7, 28, 12, tzinfo=UTC)
COLLECTOR = "00000000-0000-4000-8000-00000000c777"


def test_healthy_when_packets_are_recent_and_outbox_is_shallow(journal: Journal) -> None:
    health = assess(journal, last_packet_at=NOW - timedelta(minutes=1), now=NOW)
    assert health.status == "healthy"
    assert health.outbox_depth == 0


def test_silence_degrades_before_anyone_asks(journal: Journal) -> None:
    health = assess(journal, last_packet_at=NOW - timedelta(hours=2), now=NOW)
    assert health.status == "degraded"


def test_no_packet_ever_is_offline(journal: Journal) -> None:
    assert assess(journal, last_packet_at=None, now=NOW).status == "offline"


def test_dead_letters_outrank_a_recent_packet(journal: Journal) -> None:
    observation = load_observation("al.rank/roster_nulls_v1.json")
    journal.record(observation, al_rank.normalize(observation))
    ids = [item.id for item in journal.pending_outbox()]
    journal.mark_failed(ids, "boom", max_attempts=1, base_backoff=1.0, max_backoff=1.0)

    health = assess(journal, last_packet_at=NOW - timedelta(seconds=5), now=NOW)
    assert health.status == "sync_backlog"
    assert health.dead_letters == 3


def test_report_writes_history_and_summary(journal: Journal) -> None:
    calls: list[tuple[str, str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, json.loads(request.content)))
        return httpx.Response(201, json=[])

    client = httpx.Client(base_url="http://fake.local", transport=httpx.MockTransport(handler))
    health = assess(journal, last_packet_at=NOW - timedelta(minutes=1), now=NOW)
    report(client, COLLECTOR, health, version="1.0.0", now=NOW)

    assert [c[0] for c in calls] == ["POST", "PATCH"]
    beat = calls[0][2]
    assert calls[0][1] == "/rest/v1/collector_heartbeats"
    assert beat["collector_id"] == COLLECTOR
    assert beat["status"] == "healthy"
    assert beat["details"]["dead_letters"] == 0
    # The queue detail rides along for the admin panel; an empty journal has nothing in it.
    assert beat["details"]["queue"] == {
        "sent": 0,
        "oldest_pending_at": None,
        "pending_by_event": {},
        "dead_by_error": {},
    }
    # The summary the dashboard reads mirrors the beat.
    assert calls[1][1] == "/rest/v1/collectors"
    assert calls[1][2]["status"] == "healthy"
    assert calls[1][2]["last_heartbeat_at"] == NOW.isoformat()


def test_proof_of_life_is_the_last_row_written(journal: Journal) -> None:
    """`_last_packet_at` reads the newest ROW, not `max(captured_at)`.

    The max was a full scan of an unindexed column on the journal's biggest
    table, every heartbeat — a third of a core once the table passed a few
    million rows. Rowid order is also the more honest claim: a replay writes
    OLD captured_at values, and what the heartbeat asserts is that the
    journal is still being written now.
    """
    from dw_collector.sync.__main__ import _last_packet_at

    def observe(observation_id: str, captured_at: datetime) -> None:
        journal.conn.execute(
            "insert into raw_observations values (?, ?, ?, ?, ?, ?, ?)",
            (
                observation_id,
                COLLECTOR,
                "server.rank",
                captured_at.isoformat(),
                580,
                "{}",
                NOW.isoformat(),
            ),
        )

    assert _last_packet_at(journal) is None
    observe("11111111-1111-4111-8111-111111111101", NOW)
    # A replay: written later, captured earlier.
    observe("11111111-1111-4111-8111-111111111102", NOW - timedelta(days=30))
    journal.conn.commit()

    assert _last_packet_at(journal) == NOW - timedelta(days=30)


def test_the_queue_detail_says_what_is_waiting_and_why_rows_died(journal: Journal) -> None:
    observation = load_observation("al.rank/roster_nulls_v1.json")
    journal.record(observation, al_rank.normalize(observation))
    ids = [item.id for item in journal.pending_outbox()]
    journal.mark_failed(
        ids[:1], "The read operation timed out", max_attempts=1, base_backoff=1.0, max_backoff=1.0
    )

    detail = journal.outbox_detail()

    assert sum(detail["pending_by_event"].values()) == len(ids) - 1
    assert all(name.startswith("snapshot.") for name in detail["pending_by_event"])
    assert detail["dead_by_error"] == {"The read operation timed out": 1}
    assert detail["oldest_pending_at"] is not None


def test_the_beat_carries_the_queue_detail(journal: Journal) -> None:
    observation = load_observation("al.rank/roster_nulls_v1.json")
    journal.record(observation, al_rank.normalize(observation))

    health = assess(journal, last_packet_at=NOW - timedelta(minutes=1), now=NOW)

    assert health.outbox_depth == sum(health.queue["pending_by_event"].values()) > 0


def test_heartbeat_loop_beats_on_its_own_and_survives_failures(tmp_path: Path) -> None:
    import threading

    from dw_collector.sync.__main__ import heartbeat_loop

    db = tmp_path / "j.db"
    Journal(db).init_db()
    beats: list[str] = []
    stop = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        beats.append(request.method)
        if len(beats) == 1:
            raise httpx.ReadTimeout("The read operation timed out", request=request)
        if len(beats) >= 4:
            stop.set()
        return httpx.Response(201, json=[])

    client = httpx.Client(base_url="http://fake.local", transport=httpx.MockTransport(handler))
    thread = threading.Thread(target=heartbeat_loop, args=(db, client, "cid", 0.01, stop))
    thread.start()
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert len(beats) >= 4
