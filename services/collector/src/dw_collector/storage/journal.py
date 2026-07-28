"""SQLite edge journal — not a miniature of the cloud schema (§10.2).

Three tables: raw observations, normalized rows, and the sync outbox.
`record()` commits all three in ONE transaction (FR-COL-004): a crash at any
point leaves either the whole observation or nothing. Duplicate replays are
absorbed here by the idempotency_key uniqueness, before sync ever runs.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dw_collector.models import NormalizedRow, Observation

_SCHEMA = """
create table if not exists raw_observations (
  observation_id text primary key,
  collector_id text not null,
  source_command text not null,
  captured_at text not null,
  collected_from_server_id integer not null,
  payload_json text not null,
  created_at text not null
);

create table if not exists normalized_rows (
  id integer primary key autoincrement,
  observation_id text not null references raw_observations (observation_id),
  target_table text not null,
  idempotency_key text not null unique,
  row_json text not null,
  created_at text not null
);

-- Field set pinned by spec §10.2.
create table if not exists sync_outbox (
  id integer primary key autoincrement,
  event_type text not null,
  entity_key text not null,
  payload_json text not null,
  idempotency_key text not null unique,
  created_at text not null,
  attempt_count integer not null default 0,
  next_attempt_at text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'dead_letter')),
  last_error text
);

create index if not exists sync_outbox_pending_idx
  on sync_outbox (status, next_attempt_at);
"""


@dataclass(frozen=True)
class RecordResult:
    raw_inserted: bool
    rows_inserted: int
    rows_duplicate: int


@dataclass(frozen=True)
class OutboxItem:
    id: int
    event_type: str
    entity_key: str
    payload: NormalizedRow
    idempotency_key: str
    attempt_count: int


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


class Journal:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.execute("pragma journal_mode=wal")
        self.conn.execute("pragma foreign_keys=on")

    def init_db(self) -> None:
        with self.conn:
            self.conn.executescript(_SCHEMA)

    def close(self) -> None:
        self.conn.close()

    def record(self, observation: Observation, rows: list[NormalizedRow]) -> RecordResult:
        """Write raw + normalized + outbox atomically; replays are no-ops."""
        now = _now_iso()
        with self.conn:  # one transaction — commit on success, rollback on any error
            cur = self.conn.execute(
                "insert or ignore into raw_observations values (?, ?, ?, ?, ?, ?, ?)",
                (
                    str(observation.observation_id),
                    str(observation.collector_id),
                    observation.source_command,
                    observation.captured_at.isoformat(),
                    observation.collected_from_server_id,
                    json.dumps(observation.payload, sort_keys=True),
                    now,
                ),
            )
            raw_inserted = cur.rowcount == 1
            inserted = 0
            duplicate = 0
            for row in rows:
                cur = self.conn.execute(
                    "insert or ignore into normalized_rows"
                    " (observation_id, target_table, idempotency_key, row_json, created_at)"
                    " values (?, ?, ?, ?, ?)",
                    (
                        str(observation.observation_id),
                        row.target_table,
                        row.idempotency_key,
                        row.model_dump_json(),
                        now,
                    ),
                )
                if cur.rowcount == 1:
                    inserted += 1
                    self.conn.execute(
                        "insert into sync_outbox"
                        " (event_type, entity_key, payload_json, idempotency_key,"
                        "  created_at, next_attempt_at)"
                        " values (?, ?, ?, ?, ?, ?)",
                        (
                            f"snapshot.{row.target_table}",
                            row.idempotency_key,
                            row.model_dump_json(),
                            row.idempotency_key,
                            now,
                            now,
                        ),
                    )
                else:
                    duplicate += 1
        return RecordResult(raw_inserted, inserted, duplicate)

    def pending_outbox(self, now: datetime | None = None, limit: int = 100) -> list[OutboxItem]:
        cutoff = (now or datetime.now(tz=UTC)).isoformat()
        cur = self.conn.execute(
            "select id, event_type, entity_key, payload_json, idempotency_key, attempt_count"
            " from sync_outbox"
            " where status = 'pending' and next_attempt_at <= ?"
            " order by id limit ?",
            (cutoff, limit),
        )
        return [
            OutboxItem(
                id=r[0],
                event_type=r[1],
                entity_key=r[2],
                payload=NormalizedRow.model_validate_json(r[3]),
                idempotency_key=r[4],
                attempt_count=r[5],
            )
            for r in cur.fetchall()
        ]

    def mark_sent(self, ids: list[int]) -> None:
        with self.conn:
            self.conn.executemany(
                "update sync_outbox set status = 'sent', last_error = null where id = ?",
                [(i,) for i in ids],
            )

    def mark_failed(
        self,
        ids: list[int],
        error: str,
        *,
        max_attempts: int,
        base_backoff: float,
        max_backoff: float,
        now: datetime | None = None,
    ) -> None:
        """Exponential backoff; permanent failures move to dead_letter (§10.3)."""
        current = now or datetime.now(tz=UTC)
        with self.conn:
            for item_id in ids:
                row = self.conn.execute(
                    "select attempt_count from sync_outbox where id = ?", (item_id,)
                ).fetchone()
                if row is None:
                    continue
                attempts = int(row[0]) + 1
                if attempts >= max_attempts:
                    self.conn.execute(
                        "update sync_outbox set attempt_count = ?, status = 'dead_letter',"
                        " last_error = ? where id = ?",
                        (attempts, error, item_id),
                    )
                else:
                    delay = min(max_backoff, base_backoff * (2 ** (attempts - 1)))
                    self.conn.execute(
                        "update sync_outbox set attempt_count = ?, next_attempt_at = ?,"
                        " last_error = ? where id = ?",
                        (
                            attempts,
                            (current + timedelta(seconds=delay)).isoformat(),
                            error,
                            item_id,
                        ),
                    )

    def outbox_counts(self) -> dict[str, int]:
        cur = self.conn.execute("select status, count(*) from sync_outbox group by status")
        return dict(cur.fetchall())
