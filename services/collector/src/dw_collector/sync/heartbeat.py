"""Collector health reporting (FR-COL-007, §18.1).

Two writes per beat: the append-only `collector_heartbeats` history and a
summary on `collectors` that the dashboard reads. Status is derived from
what the journal can actually see — packet age and outbox depth — rather
than asserted, so a collector that has quietly stopped decoding reports
`degraded` instead of a cheerful `healthy`.

The heartbeat table is in the realtime publication, so an operator sees
the change without polling.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

from dw_collector.storage.journal import Journal

# §18.4 alert thresholds live with the rule that computes the status.
SILENT_AFTER = timedelta(minutes=15)
BACKLOG_ROWS = 500


@dataclass(frozen=True)
class Health:
    status: str
    outbox_depth: int
    dead_letters: int
    last_packet_at: datetime | None


def assess(
    journal: Journal, *, last_packet_at: datetime | None, now: datetime | None = None
) -> Health:
    current = now or datetime.now(tz=UTC)
    counts = journal.outbox_counts()
    pending = counts.get("pending", 0)
    dead = counts.get("dead_letter", 0)

    if dead:
        # Dead letters mean rows will never reach the cloud without an
        # operator; that outranks a merely deep queue.
        status = "sync_backlog"
    elif pending > BACKLOG_ROWS:
        status = "sync_backlog"
    elif last_packet_at is None:
        status = "offline"
    elif current - last_packet_at > SILENT_AFTER:
        status = "degraded"
    else:
        status = "healthy"

    return Health(
        status=status,
        outbox_depth=pending,
        dead_letters=dead,
        last_packet_at=last_packet_at,
    )


def report(
    client: httpx.Client,
    collector_id: str,
    health: Health,
    *,
    version: str,
    now: datetime | None = None,
) -> None:
    current = (now or datetime.now(tz=UTC)).isoformat()
    body = {
        "collector_id": collector_id,
        "status": health.status,
        "version": version,
        "last_packet_at": health.last_packet_at.isoformat() if health.last_packet_at else None,
        "outbox_depth": health.outbox_depth,
        "details": {"dead_letters": health.dead_letters},
        "reported_at": current,
    }
    resp = client.post("/rest/v1/collector_heartbeats", json=body)
    resp.raise_for_status()

    summary = {
        "status": health.status,
        "version": version,
        "last_heartbeat_at": current,
        "last_packet_at": body["last_packet_at"],
        "outbox_depth": health.outbox_depth,
    }
    resp = client.patch(
        "/rest/v1/collectors",
        params={"collector_id": f"eq.{collector_id}"},
        json=summary,
    )
    resp.raise_for_status()
