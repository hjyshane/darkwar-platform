"""Outbox → Supabase sync (§10.3).

At-least-once delivery; the cloud-side unique idempotency_key plus
`resolution=ignore-duplicates` upsert turns that into a logical
exactly-once effect (FR-COL-005). Entity UUIDs (collector, alliance,
player) are resolved against Supabase by natural key before snapshot rows
go up; parents sync before children.

Uses the secret key, which bypasses RLS — it must only ever live in the
collector's environment (NFR-001).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
import structlog

from dw_collector.storage.journal import Journal, OutboxItem

log = structlog.get_logger()

# Parents before children so FKs resolve on first sync; facts last since
# they point at snapshot rows.
_TABLE_ORDER = [
    "player_snapshots",
    "alliance_snapshots",
    "alliance_member_snapshots",
    "arena_snapshots",
    "arena_entries",
    "activity_facts",
]


@dataclass(frozen=True)
class SyncConfig:
    supabase_url: str
    secret_key: str
    batch_size: int = 100
    max_attempts: int = 8
    base_backoff_seconds: float = 2.0
    max_backoff_seconds: float = 300.0


@dataclass
class DrainStats:
    sent: int = 0
    failed: int = 0
    tables: dict[str, int] = field(default_factory=dict)


class SyncError(Exception):
    pass


class SyncWorker:
    def __init__(
        self, journal: Journal, config: SyncConfig, client: httpx.Client | None = None
    ) -> None:
        self.journal = journal
        self.config = config
        self.client = client or httpx.Client(
            base_url=config.supabase_url,
            headers={
                "apikey": config.secret_key,
                "Authorization": f"Bearer {config.secret_key}",
            },
            timeout=15.0,
        )

    # -- entity resolution ---------------------------------------------------

    def _get_one(self, table: str, params: dict[str, str]) -> dict[str, Any] | None:
        resp = self.client.get(f"/rest/v1/{table}", params=params)
        resp.raise_for_status()
        found: list[dict[str, Any]] = resp.json()
        return found[0] if found else None

    def _insert(self, table: str, body: dict[str, Any] | list[dict[str, Any]]) -> Any:
        resp = self.client.post(
            f"/rest/v1/{table}",
            json=body,
            headers={"Prefer": "return=representation"},
        )
        resp.raise_for_status()
        return resp.json()

    def ensure_collector(self, collector_id: str) -> None:
        existing = self._get_one(
            "collectors", {"collector_id": f"eq.{collector_id}", "select": "collector_id"}
        )
        if existing is None:
            self._insert(
                "collectors",
                {"collector_id": collector_id, "name": f"collector-{collector_id}"},
            )

    def ensure_alliance(self, ref: dict[str, Any]) -> str:
        params = {
            "server_id": f"eq.{ref['server_id']}",
            "external_id": f"eq.{ref['external_id']}",
            "select": "alliance_id",
        }
        existing = self._get_one("alliances", params)
        if existing is not None:
            return str(existing["alliance_id"])
        created = self._insert(
            "alliances",
            {
                "server_id": ref["server_id"],
                "external_id": ref["external_id"],
                "current_name": ref.get("name"),
                "current_code": ref.get("code"),
            },
        )
        return str(created[0]["alliance_id"])

    def ensure_players(self, refs: list[dict[str, Any]]) -> dict[int, str]:
        """game_uid → player_id, creating unknown players on the fly."""
        uids = sorted({int(r["game_uid"]) for r in refs})
        if not uids:
            return {}
        resolved: dict[int, str] = {}
        resp = self.client.get(
            "/rest/v1/players",
            params={
                "game_uid": f"in.({','.join(str(u) for u in uids)})",
                "select": "player_id,game_uid",
            },
        )
        resp.raise_for_status()
        for row in resp.json():
            resolved[int(row["game_uid"])] = str(row["player_id"])
        by_uid = {int(r["game_uid"]): r for r in refs}
        missing = [u for u in uids if u not in resolved]
        if missing:
            created = self._insert(
                "players",
                [
                    {
                        "game_uid": u,
                        "server_id": by_uid[u]["server_id"],
                        "current_name": by_uid[u].get("name"),
                    }
                    for u in missing
                ],
            )
            for row in created:
                resolved[int(row["game_uid"])] = str(row["player_id"])
        return resolved

    # -- drain ---------------------------------------------------------------

    def _resolve_rows(self, items: list[OutboxItem]) -> list[dict[str, Any]]:
        alliance_ids: dict[tuple[int, str], str] = {}
        player_refs: list[dict[str, Any]] = []
        for item in items:
            if "player" in item.payload.entity_refs:
                player_refs.append(item.payload.entity_refs["player"])
        players = self.ensure_players(player_refs)

        rows: list[dict[str, Any]] = []
        for item in items:
            row = dict(item.payload.row)
            # The key lives on the outbox item; inject it here so the row and
            # the delivery envelope cannot drift apart.
            row["idempotency_key"] = item.idempotency_key
            refs = item.payload.entity_refs
            if "alliance" in refs:
                ref = refs["alliance"]
                key = (int(ref["server_id"]), str(ref["external_id"]))
                if key not in alliance_ids:
                    alliance_ids[key] = self.ensure_alliance(ref)
                row["alliance_id"] = alliance_ids[key]
            if "player" in refs:
                row["player_id"] = players.get(int(refs["player"]["game_uid"]))
            rows.append(row)
        return rows

    def _upsert(self, table: str, rows: list[dict[str, Any]]) -> None:
        resp = self.client.post(
            f"/rest/v1/{table}",
            params={"on_conflict": "idempotency_key"},
            json=rows,
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )
        if resp.status_code >= 400:
            raise SyncError(f"{table}: HTTP {resp.status_code}: {resp.text[:300]}")

    def drain_once(self, now: datetime | None = None) -> DrainStats:
        stats = DrainStats()
        items = self.journal.pending_outbox(now=now, limit=self.config.batch_size)
        if not items:
            return stats

        # Collector registration is the first network touch; a dead network
        # must back everything off, not raise out of the drain (FR-COL-006).
        try:
            seen_collectors: set[str] = set()
            for item in items:
                cid = str(item.payload.row.get("collector_id", ""))
                if cid and cid not in seen_collectors:
                    try:
                        uuid.UUID(cid)
                    except ValueError:
                        continue
                    self.ensure_collector(cid)
                    seen_collectors.add(cid)
        except (httpx.HTTPError, SyncError) as exc:
            log.warning("sync.collector_registration_failed", error=str(exc))
            self.journal.mark_failed(
                [i.id for i in items],
                str(exc),
                max_attempts=self.config.max_attempts,
                base_backoff=self.config.base_backoff_seconds,
                max_backoff=self.config.max_backoff_seconds,
                now=now,
            )
            stats.failed = len(items)
            return stats

        by_table: dict[str, list[OutboxItem]] = {}
        for item in items:
            by_table.setdefault(item.payload.target_table, []).append(item)

        order = {t: i for i, t in enumerate(_TABLE_ORDER)}
        for table in sorted(by_table, key=lambda t: order.get(t, len(order))):
            batch = by_table[table]
            try:
                rows = self._resolve_rows(batch)
                self._upsert(table, rows)
            except (httpx.HTTPError, SyncError) as exc:
                log.warning("sync.batch_failed", table=table, error=str(exc))
                self.journal.mark_failed(
                    [i.id for i in batch],
                    str(exc),
                    max_attempts=self.config.max_attempts,
                    base_backoff=self.config.base_backoff_seconds,
                    max_backoff=self.config.max_backoff_seconds,
                    now=now,
                )
                stats.failed += len(batch)
                continue
            self.journal.mark_sent([i.id for i in batch])
            stats.sent += len(batch)
            stats.tables[table] = stats.tables.get(table, 0) + len(batch)
        return stats
