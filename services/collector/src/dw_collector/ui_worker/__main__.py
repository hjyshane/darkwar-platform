"""dw-ui-worker: open the collector's screens so capture can record them.

Read-only screens only. This drives rosters and ranking tabs — the things
that make the server send data — and takes no action that changes game
state. That is not a coincidence: every step is verified by the response it
produces, and a step that changes state has no such proof (see runner.py).

Requires `dw-capture` to already be running; without it nothing is
journalled, step one fails verification, and the routine stops.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

import typer

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector.envfile import load_env_file
from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.adb import AdbClient, list_devices
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy
from dw_collector.ui_worker.routine import Routine
from dw_collector.ui_worker.runner import RoutineRunner

app = typer.Typer(no_args_is_help=True)

_SERIAL = typer.Option("--serial", help="target serial; must equal DW_ADB_COLLECTOR_SERIAL")
_ADB = typer.Option("--adb", help="path to adb executable")


@app.callback()
def _bootstrap() -> None:
    load_env_file()


@app.command()
def devices(adb: Annotated[str, _ADB] = "adb") -> None:
    """List serials adb can see, and say which one automation would accept.

    Printing the policy's verdict here is the point: it is how the operator
    finds the collector serial without guessing, and how a misconfigured
    denylist surfaces before a routine runs rather than during one.
    """
    policy = AdbPolicy.from_env()
    found = list_devices(adb)
    typer.echo(f"adb sees {len(found)} device(s):")
    for serial in found:
        try:
            policy.check_target(serial)
            verdict = "ALLOWED (collector)"
        except AdbGuardError as exc:
            verdict = f"refused — {exc}"
        typer.echo(f"  {serial}  {verdict}")
    if not found:
        typer.echo("  (none — is BlueStacks running and adb connected?)")


@app.command()
def screenshot(
    out: Annotated[Path, typer.Option(help="where to write the PNG")],
    serial: Annotated[str | None, _SERIAL] = None,
    adb: Annotated[str, _ADB] = "adb",
) -> None:
    """Pull a screenshot so routine coordinates can be read off a real screen."""
    policy = AdbPolicy.from_env()
    try:
        target = policy.check_target(serial or policy.collector_serial)
    except AdbGuardError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    AdbClient(policy=policy, serial=target, executable=adb).screenshot(out)
    typer.echo(f"wrote {out}")


@app.command()
def run(
    routine: Annotated[Path, typer.Option(exists=True, dir_okay=False)],
    serial: Annotated[str | None, _SERIAL] = None,
    db: Annotated[Path | None, typer.Option("--db", help="SQLite path")] = None,
    adb: Annotated[str, _ADB] = "adb",
    dry_run: Annotated[bool, typer.Option(help="print the taps, touch nothing")] = False,
) -> None:
    """Walk a routine, stopping at the first step that cannot be verified."""
    policy = AdbPolicy.from_env()
    try:
        target = policy.check_target(serial or policy.collector_serial)
    except AdbGuardError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc

    plan = Routine.load(routine)
    path = db or Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db"))
    journal = Journal(path)
    journal.init_db()
    try:
        client = AdbClient(policy=policy, serial=target, executable=adb, dry_run=dry_run)
        report = RoutineRunner(client, journal).run(plan)
    finally:
        journal.close()

    typer.echo(f"routine={report.routine} serial={target}{' (dry run)' if dry_run else ''}")
    for step in report.steps:
        detail = f" saw={step.observed}" if step.observed else ""
        missing = f" MISSING={step.missing}" if step.missing else ""
        typer.echo(f"  {step.status:<11} {step.name}{detail}{missing}")
    if report.aborted_at:
        typer.echo(f"\nABORTED at {report.aborted_at!r}: {report.abort_reason}", err=True)
        raise typer.Exit(code=1)
    typer.echo("\nall steps verified")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
