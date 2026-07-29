"""S8 exit proof against the real local Supabase stack.

Requires `supabase start` and SUPABASE_SECRET_KEY in the environment;
skipped otherwise (CI's python job has no stack — the db job covers the
schema side).
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import pytest

from dw_collector.normalize import al_rank, arena
from dw_collector.storage.journal import Journal
from dw_collector.sync.worker import SyncConfig, SyncWorker
from tests.conftest import load_observation

pytestmark = pytest.mark.supabase

SUPABASE_URL = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321")
SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
FIXTURE_COLLECTOR = "00000000-0000-4000-8000-00000000c777"


@pytest.fixture(scope="module")
def client() -> httpx.Client:
    if not SECRET_KEY:
        pytest.skip("SUPABASE_SECRET_KEY not set")
    c = httpx.Client(
        base_url=SUPABASE_URL,
        headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}"},
        timeout=10.0,
    )
    try:
        c.get("/rest/v1/", timeout=3.0)
    except httpx.HTTPError:
        pytest.skip("local Supabase stack is not running")
    # Make the module re-runnable: drop anything this collector wrote before.
    # Facts first (they point at snapshots) and by key prefix, since
    # activity_facts carries no collector_id.
    c.delete(
        "/rest/v1/activity_facts",
        params={"idempotency_key": "like.fact:arena_participation:*"},
    )
    for table in ("arena_entries", "arena_snapshots", "alliance_member_snapshots"):
        c.delete(f"/rest/v1/{table}", params={"collector_id": f"eq.{FIXTURE_COLLECTOR}"})
    return c


def _count(client: httpx.Client, table: str) -> int:
    resp = client.get(
        f"/rest/v1/{table}",
        params={"collector_id": f"eq.{FIXTURE_COLLECTOR}", "select": "snapshot_id"},
        headers={"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"},
    )
    resp.raise_for_status()
    return int(resp.headers["content-range"].split("/")[1])


def test_replay_then_sync_is_logically_exactly_once(client: httpx.Client, journal: Journal) -> None:
    observations: list[Any] = [
        (load_observation("al.rank/cbfw_roster_v1.json"), al_rank.normalize),
        (load_observation("al.rank/roster_nulls_v1.json"), al_rank.normalize),
        (load_observation("user.get.arena.info/synthetic_week_v1.json"), arena.normalize),
    ]
    for observation, normalize in observations:
        journal.record(observation, normalize(observation))

    worker = SyncWorker(
        journal, SyncConfig(supabase_url=SUPABASE_URL, secret_key=SECRET_KEY, batch_size=500)
    )
    stats = worker.drain_once()
    assert stats.failed == 0
    assert stats.sent == 117  # 93 + 3 roster rows, 1 header, 20 entries

    counts = {
        t: _count(client, t)
        for t in (
            "alliance_member_snapshots",
            "arena_snapshots",
            "arena_entries",
        )
    }
    assert counts == {
        "alliance_member_snapshots": 96,
        "arena_snapshots": 1,
        "arena_entries": 20,
    }

    # Replaying the fixtures is absorbed by the journal...
    for observation, normalize in observations:
        result = journal.record(observation, normalize(observation))
        assert result.rows_inserted == 0
    assert worker.drain_once().sent == 0

    # ...and even a forced resend is absorbed by the cloud-side unique
    # idempotency_key upsert (FR-COL-005: logical exactly-once).
    with journal.conn:
        journal.conn.execute("update sync_outbox set status = 'pending'")
    stats = worker.drain_once()
    assert stats.failed == 0
    assert stats.sent == 117
    assert {t: _count(client, t) for t in counts} == counts


def test_network_cut_and_recovery(client: httpx.Client, journal: Journal) -> None:
    """S12 failure injection: sync fails mid-flight, nothing is lost, and
    recovery preserves parent-before-child order (entries' FK to the header
    could not resolve otherwise)."""
    import uuid
    from datetime import UTC, datetime, timedelta

    base = load_observation("user.get.arena.info/synthetic_week_v1.json")
    observation = base.model_copy(
        update={
            "observation_id": uuid.uuid4(),
            # New field → new payload hash → genuinely new rows and a new
            # arena header PK, so FK ordering is exercised for real.
            "payload": {**base.payload, "failure_injection_run": str(uuid.uuid4())},
        }
    )
    journal.record(observation, arena.normalize(observation))
    now = datetime.now(tz=UTC)

    # Network cut: nothing listens on port 9. Everything fails, nothing is
    # lost, attempts are recorded.
    dead = SyncWorker(
        journal,
        SyncConfig(
            supabase_url="http://127.0.0.1:9",
            secret_key=SECRET_KEY,
            base_backoff_seconds=5.0,
        ),
    )
    stats = dead.drain_once(now=now)
    assert stats.sent == 0
    assert stats.failed == 21
    assert journal.outbox_counts() == {"pending": 21}

    # Recovery after backoff: full drain, header before entries.
    worker = SyncWorker(
        journal, SyncConfig(supabase_url=SUPABASE_URL, secret_key=SECRET_KEY, batch_size=500)
    )
    stats = worker.drain_once(now=now + timedelta(seconds=6))
    assert stats.failed == 0
    assert stats.sent == 21
    assert journal.outbox_counts() == {"sent": 21}


def test_fact_drills_down_to_original_observation(client: httpx.Client, journal: Journal) -> None:
    """S11/FR-ACT-008: fact → snapshot row → observation_id → raw payload."""
    from dw_collector import pipeline

    observation = load_observation("user.get.arena.info/synthetic_week_v1.json")
    journal.record(observation, pipeline.process(observation))

    worker = SyncWorker(
        journal, SyncConfig(supabase_url=SUPABASE_URL, secret_key=SECRET_KEY, batch_size=500)
    )
    stats = worker.drain_once()
    assert stats.failed == 0

    # Pick one fact in the cloud...
    resp = client.get(
        "/rest/v1/activity_facts",
        params={
            "idempotency_key": "like.fact:arena_participation:*",
            "select": "fact_id,player_id,source_type,source_snapshot_id,measurement_type",
            "limit": "1",
        },
    )
    resp.raise_for_status()
    facts = resp.json()
    assert len(facts) == 1
    fact = facts[0]
    assert fact["measurement_type"] == "observed"
    assert fact["player_id"] is not None

    # ...follow source_snapshot_id to the arena entry...
    resp = client.get(
        f"/rest/v1/{fact['source_type']}",
        params={
            "snapshot_id": f"eq.{fact['source_snapshot_id']}",
            "select": "observation_id,player_id,game_uid",
        },
    )
    resp.raise_for_status()
    entries = resp.json()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["player_id"] == fact["player_id"]
    assert entry["observation_id"] == str(observation.observation_id)

    # ...and back to the raw decoded payload in the local journal.
    row = journal.conn.execute(
        "select payload_json from raw_observations where observation_id = ?",
        (entry["observation_id"],),
    ).fetchone()
    assert row is not None
    assert str(entry["game_uid"]) in row[0]
