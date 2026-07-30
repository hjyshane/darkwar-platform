"""dw-collector CLI: init-db, replay, sync, extract-fixture, scan-capture."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector import pipeline, registry
from dw_collector.envfile import load_env_file
from dw_collector.models import Observation
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
        observation = Observation.model_validate(json.loads(fixture.read_text()))
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
    captured_at: Annotated[str, typer.Option(help="ISO timestamp of the capture")],
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
    out.write_text(observation.model_dump_json(indent=2) + "\n")
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
    import uuid
    from datetime import UTC, datetime

    from dw_collector import pipeline
    from dw_collector.protocol.pcapng import iter_extension_events

    collector_id = uuid.UUID(
        os.environ.get("DW_COLLECTOR_ID", "00000000-0000-4000-8000-00000000c777")
    )
    # A pcap has no trustworthy wall-clock for the decoded response, so the
    # scan time is the observation time; the manifest records the real one.
    captured_at = datetime.now(tz=UTC)

    journal = _open_journal(db)
    ingested = discovered = rejected = 0
    commands: dict[str, int] = {}
    try:
        for index, event in enumerate(iter_extension_events(pcap, port=port)):
            if event.direction != "inbound":
                continue
            known = registry.get(event.command) is not None
            if discover_only and known:
                continue
            observation = Observation(
                observation_id=uuid.uuid5(
                    uuid.NAMESPACE_URL, f"dw-scan:{pcap.name}:{index}:{event.command}"
                ),
                collector_id=collector_id,
                source_command=event.command,
                captured_at=captured_at,
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
    finally:
        journal.close()

    typer.echo(
        f"ingested={ingested} discovered={discovered} rejected={rejected} commands={len(commands)}"
    )


if __name__ == "__main__":
    app()
