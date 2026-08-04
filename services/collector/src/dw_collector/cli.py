"""dw-collector CLI: init-db, replay, sync, extract-fixture, scan-capture."""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector import pipeline, registry
from dw_collector.envfile import load_env_file
from dw_collector.models import Observation
from dw_collector.protocol.pcapng import PcapError
from dw_collector.storage.journal import Journal
from dw_collector.sync.worker import SyncConfig, SyncWorker

app = typer.Typer(no_args_is_help=True)


@app.callback()
def _bootstrap() -> None:
    """Load .env before a command resolves its options.

    Runs for every subcommand, so `SUPABASE_URL` and friends work from a
    file instead of only from the shell.
    """
    load_env_file()


_DB_OPTION = typer.Option("--db", help="SQLite path (default: $DW_SQLITE_PATH)")


def _db_path(db: Path | None) -> Path:
    path = db or Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db"))
    return path


def _open_journal(db: Path | None) -> Journal:
    journal = Journal(_db_path(db))
    journal.init_db()
    return journal


@app.command("init-db")
def init_db(db: Annotated[Path | None, _DB_OPTION] = None) -> None:
    """Create (or migrate) the local edge journal."""
    path = _db_path(db)
    _open_journal(db).close()
    typer.echo(f"journal ready at {path}")


@app.command()
def replay(
    fixture: Annotated[Path, typer.Option(exists=True, dir_okay=False)],
    db: Annotated[Path | None, _DB_OPTION] = None,
) -> None:
    """Feed one decoded fixture through the pipeline (S7).

    Writes raw + normalized + outbox in a single SQLite transaction
    (FR-COL-004). Replaying the same fixture is a no-op.
    """
    try:
        observation = Observation.model_validate(json.loads(fixture.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, ValidationError) as exc:
        typer.echo(f"fixture is not a valid Observation: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    try:
        rows = pipeline.process(observation)
    except pipeline.UnknownCommandError as exc:
        # FR-COL-003/008: unknown commands are discovery input, not crashes.
        typer.echo(
            f"no normalizer for {exc.command!r}"
            f" (known: {sorted(registry.known_commands())}); nothing recorded",
            err=True,
        )
        raise typer.Exit(code=1) from exc
    except ValidationError as exc:
        typer.echo(f"payload rejected by {observation.source_command} normalizer: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    journal = _open_journal(db)
    try:
        result = journal.record(observation, rows)
    finally:
        journal.close()
    typer.echo(
        f"recorded raw={'new' if result.raw_inserted else 'duplicate'}"
        f" rows={result.rows_inserted} duplicates={result.rows_duplicate}"
    )


@app.command()
def renormalize(
    source: Annotated[Path, typer.Option(exists=True, dir_okay=False)],
    db: Annotated[Path | None, _DB_OPTION] = None,
) -> None:
    """Rebuild a journal's normalized rows from its raw observations.

    A journal holds what the parsers made of an observation ON THE DAY IT
    ARRIVED. Parsers improve — weekly donation only became a column in 0029,
    arena lineups only got decoded in 0025 — and until now nothing brought an
    old journal forward. A real one captured before both carried 135
    contribution rows and no lineups at all; the same raw observations
    through today's parsers give 1,615 and 3,998.

    That the raw payloads are kept and idempotency keys hash them rather than
    the normalized row (§11.2) is what makes this safe: the same observation
    reprocessed keeps its keys, so replaying into Supabase updates rather
    than duplicating. This command is the thing that design was for, and it
    was missing.

    Writes to a SEPARATE journal, never in place. The source is somebody's
    real capture history and a bug in a parser must not be able to eat it.
    """
    reader = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    journal = _open_journal(db)
    processed = unknown = rejected = 0
    known = set(registry.known_commands())
    try:
        rows_iter = reader.execute(
            "select observation_id, collector_id, source_command, captured_at,"
            " collected_from_server_id, payload_json from raw_observations"
        )
        for observation_id, collector_id, command, captured_at, server_id, payload in rows_iter:
            if command not in known:
                # Not a failure. Most of a capture is commands nobody has
                # written a parser for, and they stay in the raw table as
                # discovery input (FR-COL-003/008).
                unknown += 1
                continue
            try:
                observation = Observation(
                    observation_id=observation_id,
                    collector_id=collector_id,
                    source_command=command,
                    captured_at=captured_at,
                    collected_from_server_id=server_id,
                    payload=json.loads(payload),
                )
                rows = pipeline.process(observation)
            except (json.JSONDecodeError, ValidationError, pipeline.UnknownCommandError):
                # One unparseable observation must not stop the other 1,983.
                rejected += 1
                continue
            journal.record(observation, rows)
            processed += 1
    finally:
        reader.close()
        journal.close()
    typer.echo(f"renormalized={processed} no-parser={unknown} rejected={rejected}")


@app.command()
def sync(
    db: Annotated[Path | None, _DB_OPTION] = None,
    url: Annotated[str | None, typer.Option(envvar="SUPABASE_URL")] = None,
    secret_key: Annotated[str | None, typer.Option(envvar="SUPABASE_SECRET_KEY")] = None,
) -> None:
    """Drain the outbox to Supabase once (S8)."""
    if not url or not secret_key:
        typer.echo("SUPABASE_URL and SUPABASE_SECRET_KEY are required", err=True)
        raise typer.Exit(code=1)
    path = _db_path(db)
    journal = _open_journal(db)
    try:
        worker = SyncWorker(journal, SyncConfig(supabase_url=url, secret_key=secret_key))
        stats = worker.drain_once()
        counts = journal.outbox_counts()
    finally:
        journal.close()
    # The journal path is in the output because syncing the wrong one — a
    # fresh, empty journal in whichever checkout you happened to be in —
    # otherwise looks exactly like having nothing to send.
    typer.echo(f"journal={path}")
    typer.echo(f"sent={stats.sent} failed={stats.failed} outbox={counts}")


@app.command("journal-summary")
def journal_summary(db: Annotated[Path | None, _DB_OPTION] = None) -> None:
    """What the local journal holds: commands, target tables, outbox state."""
    path = _db_path(db)
    journal = _open_journal(db)
    try:
        commands = journal.command_counts()
        tables = journal.table_counts()
        outbox = journal.outbox_counts()
    finally:
        journal.close()

    typer.echo(f"journal={path}")
    typer.echo(f"outbox={outbox}")
    typer.echo(f"\nobservations by command ({len(commands)} distinct):")
    for command, count in commands:
        typer.echo(f"  {count:6d}  {command}")
    typer.echo("\nnormalized rows by table:")
    for table, count in tables:
        typer.echo(f"  {count:6d}  {table}")


@app.command("clock-skew")
def clock_skew(db: Annotated[Path | None, _DB_OPTION] = None) -> None:
    """Compare the game server's clock against ours, per observation.

    The collector timestamps everything from the local clock, so a machine
    whose clock drifts silently mislabels when data was seen. This makes
    that measurable instead of assumed: every `push.utc.time` the capture
    already journals carries the server's own wall clock.
    """
    from dw_collector.clock import SOURCE_COMMAND, server_time

    journal = _open_journal(db)
    try:
        samples = journal.raw_payloads(SOURCE_COMMAND)
    finally:
        journal.close()

    if not samples:
        typer.echo(
            f"no {SOURCE_COMMAND} observations yet — it arrives on login,"
            " so capture a game start to get one"
        )
        return

    typer.echo(f"{len(samples)} sample(s)  (server minus local; positive = server ahead)")
    skews = []
    for observed_at, payload_json in samples:
        payload = json.loads(payload_json)
        server = server_time(payload)
        if server is None:
            typer.echo(f"  {observed_at.isoformat()}  unreadable: {payload}")
            continue
        delta = (server - observed_at).total_seconds()
        skews.append(delta)
        typer.echo(
            f"  observed {observed_at.isoformat()}  server {server.isoformat()}  skew {delta:+.1f}s"
        )
    if skews:
        typer.echo(f"\nmedian skew {sorted(skews)[len(skews) // 2]:+.1f}s")


@app.command("retry-outbox")
def retry_outbox(
    db: Annotated[Path | None, _DB_OPTION] = None,
    dead_letters: Annotated[
        bool, typer.Option(help="also retry rows that gave up (§10.3)")
    ] = False,
    already_sent: Annotated[
        bool, typer.Option(help="also resend rows already sent, e.g. after supabase db reset")
    ] = False,
) -> None:
    """Queue rows for another sync attempt. Nothing is deleted or rewritten."""
    journal = _open_journal(db)
    try:
        affected = journal.retry_outbox(dead_letters=dead_letters, already_sent=already_sent)
        counts = journal.outbox_counts()
    finally:
        journal.close()
    typer.echo(f"queued={affected} outbox={counts}")


@app.command("extract-fixture")
def extract_fixture(
    pcap: Annotated[Path, typer.Option(exists=True, dir_okay=False)],
    command: Annotated[str, typer.Option()],
    out: Annotated[Path, typer.Option()],
    captured_at: Annotated[
        str | None,
        typer.Option(help="ISO timestamp; defaults to the packet's own capture time"),
    ] = None,
    collected_from_server: Annotated[int, typer.Option()] = 580,
    index: Annotated[int, typer.Option(help="nth matching inbound event")] = 0,
) -> None:
    """Decode one inbound response from a pcap into a SANITIZED fixture.

    Refuses commands without a registered sanitizer — unsanitized captures
    never become committable files. The pcap itself stays outside the repo;
    record its sha256 in protocol-fixtures/manifests/.
    """
    import hashlib
    import uuid
    from datetime import datetime

    from dw_collector.protocol.pcapng import iter_extension_events
    from dw_collector.sanitize import SANITIZERS

    sanitizer = SANITIZERS.get(command)
    if sanitizer is None:
        typer.echo(f"no sanitizer registered for {command!r}; refusing to write", err=True)
        raise typer.Exit(code=1)

    when: datetime | None = None
    if captured_at is not None:
        when = datetime.fromisoformat(captured_at)
        if when.tzinfo is None:
            typer.echo("--captured-at must include a timezone offset", err=True)
            raise typer.Exit(code=1)

    matches = [
        event
        for event in iter_extension_events(pcap)
        if event.direction == "inbound" and event.command == command
    ]
    if index >= len(matches):
        typer.echo(
            f"found {len(matches)} inbound {command!r} events; index {index} out of range", err=True
        )
        raise typer.Exit(code=1)

    when = when or matches[index].captured_at
    if when is None:
        typer.echo("the packet carries no timestamp; pass --captured-at", err=True)
        raise typer.Exit(code=1)

    pcap_sha = hashlib.sha256(pcap.read_bytes()).hexdigest()
    observation = Observation(
        observation_id=uuid.uuid5(uuid.NAMESPACE_URL, f"dw-fixture:{pcap_sha}:{command}:{index}"),
        collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c777"),
        source_command=command,
        captured_at=when,
        collected_from_server_id=collected_from_server,
        payload=sanitizer(dict(matches[index].payload)),
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(observation.model_dump_json(indent=2) + "\n", encoding="utf-8")
    typer.echo(f"wrote {out}  (source pcap sha256 {pcap_sha[:16]}…)")


@app.command("scan-capture")
def scan_capture(
    pcap: Annotated[Path, typer.Option(exists=True, dir_okay=False)],
    db: Annotated[Path | None, _DB_OPTION] = None,
    collected_from_server: Annotated[int, typer.Option()] = 580,
    port: Annotated[int, typer.Option()] = 8680,
    discover_only: Annotated[
        bool, typer.Option(help="record unknown-command shapes but ingest nothing")
    ] = False,
) -> None:
    """Ingest every inbound response in a capture through the pipeline.

    Known commands become snapshot rows; unknown ones become
    schema_observations shape records (FR-COL-008) so the next parser has
    somewhere to start. Malformed payloads are counted, not fatal
    (FR-COL-003).
    """
    collector_id = uuid.UUID(
        os.environ.get("DW_COLLECTOR_ID", "00000000-0000-4000-8000-00000000c777")
    )
    # The packet's own timestamp, not the scan's. captured_at is meant to say
    # when the data was OBSERVED, and that was when the capture engine
    # recorded the packet — possibly days ago. Stamping "now" also made the
    # idempotency key depend on the scan date, so re-scanning one pcap on two
    # days produced two copies of the same history.
    fallback = datetime.now(tz=UTC)

    journal = _open_journal(db)
    try:
        result = _ingest_capture(
            journal,
            pcap,
            collector_id=collector_id,
            collected_from_server=collected_from_server,
            port=port,
            discover_only=discover_only,
            fallback=fallback,
        )
    finally:
        journal.close()

    typer.echo(
        f"ingested={result.ingested} discovered={result.discovered}"
        f" rejected={result.rejected} commands={len(result.commands)}"
    )


@dataclass(frozen=True)
class _ScanResult:
    ingested: int
    discovered: int
    rejected: int
    commands: dict[str, int]

    @property
    def events(self) -> int:
        return self.ingested + self.discovered


def _ingest_capture(
    journal: Journal,
    pcap: Path,
    *,
    collector_id: uuid.UUID,
    collected_from_server: int,
    port: int,
    discover_only: bool,
    fallback: datetime,
) -> _ScanResult:
    """One capture file through the pipeline. Shared by scan-capture and
    ingest-dir so the continuous path cannot drift from the one that has
    been used by hand all along."""
    import uuid as _uuid

    from dw_collector import pipeline
    from dw_collector.protocol.pcapng import iter_extension_events

    ingested = discovered = rejected = 0
    commands: dict[str, int] = {}
    for index, event in enumerate(iter_extension_events(pcap, port=port)):
        if event.direction != "inbound":
            continue
        known = registry.get(event.command) is not None
        if discover_only and known:
            continue
        observation = Observation(
            # The file name is part of the id, and dumpcap's ring buffer gives
            # every file a distinct name, so two files never collide. Replays
            # of the SAME file are harmless anyway: idempotency_key hashes the
            # raw payload (§11.2), so re-ingesting updates rather than copies.
            observation_id=_uuid.uuid5(
                _uuid.NAMESPACE_URL, f"dw-scan:{pcap.name}:{index}:{event.command}"
            ),
            collector_id=collector_id,
            source_command=event.command,
            captured_at=event.captured_at or fallback,
            collected_from_server_id=collected_from_server,
            payload=dict(event.payload),
        )
        try:
            rows = pipeline.observe(observation)
        except ValidationError:
            rejected += 1
            continue
        journal.record(observation, rows)
        commands[event.command] = commands.get(event.command, 0) + 1
        if known:
            ingested += 1
        else:
            discovered += 1
    return _ScanResult(ingested, discovered, rejected, commands)


def _ready_captures(directory: Path, minimum_age_seconds: float) -> list[Path]:
    """Capture files dumpcap has finished with, oldest first.

    The newest file in a ring buffer is the one being written, and reading
    it would ingest a truncated tail and then mark it done. Age is the test
    rather than "skip the newest", because a stopped dumpcap leaves its last
    file complete and that one should still be read.
    """
    now = time.time()
    ready = [
        path
        for path in directory.glob("*.pcapng")
        if now - path.stat().st_mtime >= minimum_age_seconds
    ]
    return sorted(ready, key=lambda p: p.stat().st_mtime)


@app.command("ingest-dir")
def ingest_dir(
    directory: Annotated[Path, typer.Option("--dir", exists=True, file_okay=False)],
    db: Annotated[Path | None, _DB_OPTION] = None,
    collected_from_server: Annotated[int, typer.Option()] = 580,
    port: Annotated[int, typer.Option()] = 8680,
    min_age_seconds: Annotated[
        float, typer.Option(help="skip files touched more recently than this")
    ] = 30.0,
    interval_seconds: Annotated[
        float, typer.Option(help="0 runs once and exits; otherwise poll forever")
    ] = 0.0,
) -> None:
    """Ingest pcapng files a capture engine leaves in a directory.

    The point is dumpcap rather than dw-capture as the packet source. Live
    capture keeps one reassembler for the life of the process, so a stream
    that wedges stays wedged and the collector goes quiet while still
    looking healthy. Reading files gives every file a fresh reassembler,
    which bounds that failure to one file instead of to the rest of the run.

    Files already read are recorded in the journal, so restarting does not
    re-read the ring.
    """
    collector_id = uuid.UUID(
        os.environ.get("DW_COLLECTOR_ID", "00000000-0000-4000-8000-00000000c777")
    )
    journal = _open_journal(db)
    try:
        while True:
            done = journal.ingested_captures()
            pending = [p for p in _ready_captures(directory, min_age_seconds) if p.name not in done]
            for pcap in pending:
                fallback = datetime.now(tz=UTC)
                try:
                    result = _ingest_capture(
                        journal,
                        pcap,
                        collector_id=collector_id,
                        collected_from_server=collected_from_server,
                        port=port,
                        discover_only=False,
                        fallback=fallback,
                    )
                except (PcapError, OSError, ValueError) as exc:
                    # One unreadable file must not stop the loop — a
                    # collector that stops on the first bad capture is the
                    # failure this command exists to escape. Marked done
                    # rather than retried: a truncated file never becomes
                    # valid, and retrying it every poll would lose
                    # everything after it instead of just that window.
                    journal.mark_capture_ingested(pcap.name, 0)
                    typer.echo(f"{pcap.name}  UNREADABLE {exc}", err=True)
                    continue
                journal.mark_capture_ingested(pcap.name, result.events)
                typer.echo(
                    f"{pcap.name}  ingested={result.ingested} discovered={result.discovered}"
                    f" rejected={result.rejected} commands={len(result.commands)}"
                )
            if interval_seconds <= 0:
                typer.echo(f"done: {len(pending)} file(s)")
                return
            time.sleep(interval_seconds)
    finally:
        journal.close()


if __name__ == "__main__":
    app()
