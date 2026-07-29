"""Collector health is derived from the journal, not asserted (FR-COL-007)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
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
    assert beat["details"] == {"dead_letters": 0}
    # The summary the dashboard reads mirrors the beat.
    assert calls[1][1] == "/rest/v1/collectors"
    assert calls[1][2]["status"] == "healthy"
    assert calls[1][2]["last_heartbeat_at"] == NOW.isoformat()
