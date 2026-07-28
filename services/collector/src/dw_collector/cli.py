"""dw-collector CLI: init-db, replay, sync."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector import registry
from dw_collector.models import Observation
from dw_collector.storage.journal import Journal
from dw_collector.sync.worker import SyncConfig, SyncWorker

app = typer.Typer(no_args_is_help=True)

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

    normalizer = registry.get(observation.source_command)
    if normalizer is None:
        # FR-COL-003/008: unknown commands are discovery input, not crashes.
        typer.echo(
            f"no normalizer for {observation.source_command!r}"
            f" (known: {sorted(registry.known_commands())}); nothing recorded",
            err=True,
        )
        raise typer.Exit(code=1)

    try:
        rows = normalizer(observation)
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
    journal = _open_journal(db)
    try:
        worker = SyncWorker(journal, SyncConfig(supabase_url=url, secret_key=secret_key))
        stats = worker.drain_once()
        counts = journal.outbox_counts()
    finally:
        journal.close()
    typer.echo(f"sent={stats.sent} failed={stats.failed} outbox={counts}")


if __name__ == "__main__":
    app()
