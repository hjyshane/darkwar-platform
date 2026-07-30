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
    for table in (
        "arena_entries",
        "arena_snapshots",
        "alliance_member_snapshots",
        "player_detail_snapshots",
        "player_snapshots",
        "alliance_snapshots",
    ):
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
        (load_observation("user.get.arena.info/top100_580v582_v1.json"), arena.normalize),
    ]
    for observation, normalize in observations:
        journal.record(observation, normalize(observation))

    worker = SyncWorker(
        journal, SyncConfig(supabase_url=SUPABASE_URL, secret_key=SECRET_KEY, batch_size=500)
    )
    stats = worker.drain_once()
    assert stats.failed == 0
    assert stats.sent == 197  # 93 + 3 roster rows, 1 header, 100 entries

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
        "arena_entries": 100,
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
    assert stats.sent == 197
    assert {t: _count(client, t) for t in counts} == counts


def test_network_cut_and_recovery(client: httpx.Client, journal: Journal) -> None:
    """S12 failure injection: sync fails mid-flight, nothing is lost, and
    recovery preserves parent-before-child order (entries' FK to the header
    could not resolve otherwise)."""
    import uuid
    from datetime import UTC, datetime, timedelta

    base = load_observation("user.get.arena.info/top100_580v582_v1.json")
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
            batch_size=500,
        ),
    )
    stats = dead.drain_once(now=now)
    assert stats.sent == 0
    assert stats.failed == 101
    assert journal.outbox_counts() == {"pending": 101}

    # Recovery after backoff: full drain, header before entries.
    worker = SyncWorker(
        journal, SyncConfig(supabase_url=SUPABASE_URL, secret_key=SECRET_KEY, batch_size=500)
    )
    stats = worker.drain_once(now=now + timedelta(seconds=6))
    assert stats.failed == 0
    assert stats.sent == 101
    assert journal.outbox_counts() == {"sent": 101}


def test_fact_drills_down_to_original_observation(client: httpx.Client, journal: Journal) -> None:
    """S11/FR-ACT-008: fact → snapshot row → observation_id → raw payload."""
    from dw_collector import pipeline

    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
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


def test_all_promoted_parsers_reach_supabase(client: httpx.Client, journal: Journal) -> None:
    """Every confirmed command, decoded from real captures, lands in its
    table through the same journal → outbox → upsert path (S14 exit)."""
    from dw_collector import pipeline

    fixtures = [
        "al.rank/cbfw_roster_v1.json",
        "alliance.rank/local_580_v1.json",
        "alliance.rank/cross_group_v1.json",
        "get.al.info/love_580_v1.json",
        "server.rank/group_top150_v1.json",
        "get.new.user.info/profile_578_v1.json",
        "get.user.info.multi/summary_578_v1.json",
        "user.get.arena.info/top100_580v582_v1.json",
    ]
    expected_rows = 0
    for name in fixtures:
        observation = load_observation(name)
        rows = pipeline.process(observation)
        expected_rows += len(rows)
        journal.record(observation, rows)

    worker = SyncWorker(
        journal, SyncConfig(supabase_url=SUPABASE_URL, secret_key=SECRET_KEY, batch_size=1000)
    )
    stats = worker.drain_once()
    assert stats.failed == 0
    assert stats.sent == expected_rows
    assert set(stats.tables) == {
        "player_snapshots",
        "player_detail_snapshots",
        "alliance_snapshots",
        "alliance_member_snapshots",
        "arena_snapshots",
        "arena_entries",
        "activity_facts",
    }
    # alliance.rank(41+100) + get.al.info(1) all target alliance_snapshots.
    assert stats.tables["alliance_snapshots"] == 142
    # server.rank(150) + get.user.info.multi(1).
    assert stats.tables["player_snapshots"] == 151
    assert stats.tables["player_detail_snapshots"] == 1

    # The six-power verification survived the round trip.
    resp = client.get(
        "/rest/v1/player_detail_snapshots",
        params={
            "game_uid": "eq.9629347793000578",
            "select": "components_sum_matches,power_total",
        },
    )
    resp.raise_for_status()
    assert resp.json()[0]["components_sum_matches"] is True

    # Replaying everything is absorbed; no duplicate rows.
    for name in fixtures:
        observation = load_observation(name)
        assert journal.record(observation, pipeline.process(observation)).rows_inserted == 0


def test_untracked_server_is_registered_against_the_real_schema(
    client: httpx.Client, journal: Journal
) -> None:
    """server_id has a real FK. A cross-server ranking that reaches outside
    577-584 would fail the batch unless sync registers the server first."""
    from dw_collector import pipeline

    observation = load_observation("al.battle.rank.info/battle_type0_v1.json")
    journal.record(observation, pipeline.process(observation))

    worker = SyncWorker(
        journal, SyncConfig(supabase_url=SUPABASE_URL, secret_key=SECRET_KEY, batch_size=1000)
    )
    stats = worker.drain_once()
    assert stats.failed == 0
    assert stats.sent == 324  # 162 contribution rows + 162 facts

    resp = client.get(
        "/rest/v1/servers",
        params={"server_id": "eq.586", "select": "server_id,server_group,is_tracked"},
    )
    resp.raise_for_status()
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["is_tracked"] is False
    assert rows[0]["server_group"] == "unknown"

    # And the contribution rows for that server actually landed.
    resp = client.get(
        "/rest/v1/alliance_contribution_snapshots",
        params={"server_id": "eq.586", "select": "score", "limit": "1"},
    )
    resp.raise_for_status()
    assert resp.json()
