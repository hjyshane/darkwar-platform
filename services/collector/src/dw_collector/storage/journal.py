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

from dw_collector.models import NormalizedRow, Observation, json_default

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

-- Which capture files ingest-dir has already read. Re-reading one is safe
-- (idempotency_key hashes the raw payload, so a replay updates rather than
-- duplicates) but it is wasted work, and on a ring buffer of 288 files it
-- would be most of the work.
create table if not exists ingested_captures (
  name text primary key,
  ingested_at text not null,
  events integer not null
);
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
    def __init__(self, path: Path, *, single_writer_thread: bool = False) -> None:
        """`single_writer_thread` opts out of sqlite3's own thread check.

        Only dw-capture sets it, and only because its writes all happen on
        SegmentPump's one worker thread — the sniffer never touches the
        journal. The check exists to catch concurrent use, and there is
        none here; what there is, is a connection opened on the thread that
        starts the process and used on the thread that does the work.

        Left off by default so that anything which grows a second writer
        gets the loud error rather than a corrupt database.
        """
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=not single_writer_thread)
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
                    json.dumps(observation.payload, sort_keys=True, default=json_default),
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

    def command_counts(self) -> list[tuple[str, int]]:
        """Observations per command, most frequent first."""
        cur = self.conn.execute(
            "select source_command, count(*) from raw_observations"
            " group by source_command order by count(*) desc, source_command"
        )
        return [(str(r[0]), int(r[1])) for r in cur.fetchall()]

    def ingested_captures(self) -> set[str]:
        """Capture file names already read by ingest-dir."""
        cur = self.conn.execute("select name from ingested_captures")
        return {str(row[0]) for row in cur.fetchall()}

    def mark_capture_ingested(self, name: str, events: int) -> None:
        with self.conn:
            self.conn.execute(
                "insert or replace into ingested_captures (name, ingested_at, events)"
                " values (?, ?, ?)",
                (name, _now_iso(), events),
            )

    def watermark(self) -> int:
        """Insert position to compare later arrivals against.

        A wall clock cannot answer this on Windows. `datetime.now()` there
        resolves to about 15.6ms, and six consecutive calls on the collector
        box return the same value — so "written after I tapped" compared on
        created_at silently means "written at least a tick after I tapped".
        rowid is exact, monotonic, and needs no clock at all.
        """
        cur = self.conn.execute("select coalesce(max(rowid), 0) from raw_observations")
        return int(cur.fetchone()[0])

    def commands_after(self, mark: int, since: datetime | None = None) -> set[str]:
        """Commands journalled after `mark` — the UI worker's proof that a
        tap opened the screen it meant to.

        `mark` is a rowid, not a clock: a wall clock cannot separate two rows
        written in the same 15.6ms Windows tick. It answers "written after I
        tapped".

        `since` answers a different question, and BOTH are needed once capture
        is not instantaneous. The dumpcap ring closes a file every 60s and the
        reader follows, so a packet the game sent a minute BEFORE the tap is
        written to the journal a minute AFTER it — and satisfies a rowid-only
        test. That is not theoretical: a board sweep reported eight alliances
        verified and had actually opened two, because each step was credited
        with the previous step's late-arriving response.

        So `since` filters on `captured_at`, which is when the packet was on
        the wire. A response captured before the tap cannot be the tap's.
        Left optional because a replay sets captured_at from its fixture,
        where wire time means nothing and rowid is the only honest ordering.
        """
        if since is None:
            cur = self.conn.execute(
                "select distinct source_command from raw_observations where rowid > ?",
                (mark,),
            )
        else:
            cur = self.conn.execute(
                "select distinct source_command from raw_observations "
                "where rowid > ? and captured_at >= ?",
                (mark, since.isoformat()),
            )
        return {str(r[0]) for r in cur.fetchall()}

    def raw_payloads(self, command: str) -> list[tuple[datetime, str]]:
        """(observation time, payload JSON) for one command, oldest first.

        captured_at, not created_at: the question this serves is "what did
        our clock say when the data was observed", which for a replayed pcap
        is the packet's timestamp and not when the scan happened to run.
        """
        cur = self.conn.execute(
            "select captured_at, payload_json from raw_observations"
            " where source_command = ? order by captured_at",
            (command,),
        )
        return [(datetime.fromisoformat(str(r[0])), str(r[1])) for r in cur.fetchall()]

    def table_counts(self) -> list[tuple[str, int]]:
        """Normalized rows per target table, most frequent first."""
        cur = self.conn.execute(
            "select target_table, count(*) from normalized_rows"
            " group by target_table order by count(*) desc, target_table"
        )
        return [(str(r[0]), int(r[1])) for r in cur.fetchall()]

    def retry_outbox(self, *, dead_letters: bool = False, already_sent: bool = False) -> int:
        """Make the sync worker look at rows again; returns rows affected.

        Three real needs, none of which loses anything: clearing the backoff
        on pending rows so a recovered stack drains now, retrying dead letters
        after fixing what killed them (§10.3), and resending rows the journal
        already sent — which is what a `supabase db reset` requires, since the
        cloud forgot but the journal did not. The cloud-side unique key makes
        a redundant resend a no-op.
        """
        statuses = ["pending"]
        if dead_letters:
            statuses.append("dead_letter")
        if already_sent:
            statuses.append("sent")
        placeholders = ",".join("?" for _ in statuses)
        with self.conn:
            cur = self.conn.execute(
                "update sync_outbox set status = 'pending', attempt_count = 0,"
                f" next_attempt_at = ?, last_error = null where status in ({placeholders})",
                (_now_iso(), *statuses),
            )
        return int(cur.rowcount)

    def outbox_counts(self) -> dict[str, int]:
        cur = self.conn.execute("select status, count(*) from sync_outbox group by status")
        return dict(cur.fetchall())
