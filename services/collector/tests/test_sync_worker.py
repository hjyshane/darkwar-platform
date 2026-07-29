"""Sync worker unit tests against a scripted PostgREST double."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from dw_collector.normalize import al_rank, arena
from dw_collector.storage.journal import Journal
from dw_collector.sync.worker import SyncConfig, SyncWorker
from tests.conftest import load_observation


class FakeSupabase:
    """Just enough PostgREST: entity GET/POST plus snapshot upserts."""

    def __init__(self, fail_tables: set[str] | None = None) -> None:
        self.fail_tables = fail_tables or set()
        self.entities: dict[str, list[dict[str, Any]]] = {
            "collectors": [],
            "alliances": [],
            "players": [],
        }
        self.upserted: dict[str, list[dict[str, Any]]] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        table = request.url.path.removeprefix("/rest/v1/")
        if request.method == "GET":
            return httpx.Response(200, json=self._filtered(table, request))
        assert request.method == "POST"
        body = json.loads(request.content)
        rows = body if isinstance(body, list) else [body]
        if table in self.entities:
            created = [self._create_entity(table, row) for row in rows]
            return httpx.Response(201, json=created)
        if table in self.fail_tables:
            return httpx.Response(500, json={"message": "injected failure"})
        self.upserted.setdefault(table, []).extend(rows)
        return httpx.Response(201, json=[])

    def _filtered(self, table: str, request: httpx.Request) -> list[dict[str, Any]]:
        rows = self.entities.get(table, [])
        for key, value in request.url.params.items():
            if key == "select":
                continue
            if value.startswith("eq."):
                rows = [r for r in rows if str(r.get(key)) == value[3:]]
            elif value.startswith("in.("):
                allowed = set(value[4:-1].split(","))
                rows = [r for r in rows if str(r.get(key)) in allowed]
        return rows

    def _create_entity(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        pk = {"collectors": "collector_id", "alliances": "alliance_id", "players": "player_id"}[
            table
        ]
        created = {pk: row.get(pk, str(uuid.uuid4())), **row}
        self.entities[table].append(created)
        return created


def _loaded_journal(tmp_journal: Journal) -> Journal:
    roster = load_observation("al.rank/cbfw_roster_v1.json")
    tmp_journal.record(roster, al_rank.normalize(roster))
    week = load_observation("user.get.arena.info/top100_580v582_v1.json")
    tmp_journal.record(week, arena.normalize(week))
    return tmp_journal


def _worker(journal: Journal, fake: FakeSupabase, **config: Any) -> SyncWorker:
    client = httpx.Client(base_url="http://fake.local", transport=httpx.MockTransport(fake.handler))
    config.setdefault("batch_size", 500)  # the 93-member roster exceeds the default
    return SyncWorker(
        journal,
        SyncConfig(supabase_url="http://fake.local", secret_key="test", **config),
        client=client,
    )


def test_drain_resolves_entities_and_upserts(journal: Journal) -> None:
    fake = FakeSupabase()
    worker = _worker(_loaded_journal(journal), fake)

    stats = worker.drain_once()

    assert stats.sent == 194  # 93 roster + 1 header + 100 entries
    assert stats.failed == 0
    assert journal.outbox_counts() == {"sent": 194}
    # One collector, one alliance, 20 players created exactly once.
    assert len(fake.entities["collectors"]) == 1
    assert len(fake.entities["alliances"]) == 1
    assert len(fake.entities["players"]) == 174
    # Snapshot rows went up with resolved UUIDs.
    member_row = fake.upserted["alliance_member_snapshots"][0]
    assert member_row["alliance_id"] == fake.entities["alliances"][0]["alliance_id"]
    assert member_row["player_id"] is not None
    # Parent table synced in the same drain as its children.
    assert len(fake.upserted["arena_snapshots"]) == 1
    assert len(fake.upserted["arena_entries"]) == 100


def test_failure_backs_off_then_recovers(journal: Journal) -> None:
    fake = FakeSupabase(fail_tables={"alliance_member_snapshots", "arena_snapshots"})
    worker = _worker(_loaded_journal(journal), fake, base_backoff_seconds=10.0)
    now = datetime.now(tz=UTC)

    stats = worker.drain_once(now=now)
    assert stats.failed == 94  # roster batch + arena header; entries succeeded
    assert stats.sent == 100

    # Still backing off: nothing pending yet.
    assert worker.drain_once(now=now).sent == 0

    fake.fail_tables.clear()
    stats = worker.drain_once(now=now + timedelta(seconds=11))
    assert stats.sent == 94
    assert journal.outbox_counts() == {"sent": 194}


def test_dead_letter_after_max_attempts(journal: Journal) -> None:
    fake = FakeSupabase(fail_tables={"alliance_member_snapshots"})
    roster = load_observation("al.rank/roster_nulls_v1.json")
    journal.record(roster, al_rank.normalize(roster))
    worker = _worker(journal, fake, max_attempts=1)

    stats = worker.drain_once()
    assert stats.failed == 3
    assert journal.outbox_counts() == {"dead_letter": 3}
    # Dead letters never come back on their own (§10.3).
    assert worker.drain_once().sent == 0
