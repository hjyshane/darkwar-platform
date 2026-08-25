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
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector.envfile import load_env_file
from dw_collector.storage.journal import Journal
from dw_collector.ui_worker import probe as probe_mod
from dw_collector.ui_worker import zoom as zoom_mod
from dw_collector.ui_worker.adb import AdbClient, list_devices, wait_for_serial
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy
from dw_collector.ui_worker.idle import IdlePolicy
from dw_collector.ui_worker.routine import Routine
from dw_collector.ui_worker.runner import RoutineRunner

app = typer.Typer(no_args_is_help=True)

_SERIAL = typer.Option("--serial", help="target serial; must equal DW_ADB_COLLECTOR_SERIAL")
# envvar, because BlueStacks ships its own adb as HD-Adb.exe and does not put
# it on PATH. .env.example has asked for DW_ADB_EXECUTABLE since the ADB work
# landed; without this the variable was accepted and ignored, and every
# scheduled invocation had to repeat --adb or fail on a missing binary.
_ADB = typer.Option("--adb", envvar="DW_ADB_EXECUTABLE", help="path to adb executable")


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
    wait_for_device_seconds: Annotated[
        float,
        typer.Option(help="wait this long for the serial to appear before starting"),
    ] = 0.0,
) -> None:
    """Walk a routine, stopping at the first step that cannot be verified."""
    policy = AdbPolicy.from_env()
    try:
        target = policy.check_target(serial or policy.collector_serial)
    except AdbGuardError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc

    # Zero by default: a routine run by hand should fail immediately when the
    # emulator is not there, rather than appearing to hang. The cold start is
    # the only caller that passes a value, because it runs seconds after a boot
    # and BlueStacks is genuinely still starting.
    if wait_for_device_seconds > 0 and not dry_run:
        typer.echo(f"waiting up to {wait_for_device_seconds:.0f}s for {target}")
        if not wait_for_serial(target, timeout_seconds=wait_for_device_seconds, executable=adb):
            typer.echo(f"{target} never appeared", err=True)
            raise typer.Exit(code=2)

    plan = Routine.load(routine)
    idle = IdlePolicy.from_env()
    path = db or Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db"))
    journal = Journal(path)
    journal.init_db()
    try:
        client = AdbClient(policy=policy, serial=target, executable=adb, dry_run=dry_run)
        report = RoutineRunner(client, journal, idle=idle).run(plan)
    finally:
        journal.close()

    gate = f" idle>={idle.minimum_idle_seconds:.0f}s" if idle else ""
    typer.echo(f"routine={report.routine} serial={target}{gate}{' (dry run)' if dry_run else ''}")
    for step in report.steps:
        detail = f" saw={step.observed}" if step.observed else ""
        missing = f" MISSING={step.missing}" if step.missing else ""
        typer.echo(f"  {step.status:<11} {step.name}{detail}{missing}")
    if report.aborted_at:
        typer.echo(f"\nABORTED at {report.aborted_at!r}: {report.abort_reason}", err=True)
        raise typer.Exit(code=1)
    typer.echo("\nall steps verified")


@app.command()
def probe(
    adb: Annotated[str, _ADB] = "adb",
    db: Annotated[Path | None, typer.Option("--db")] = None,
    screen_width: Annotated[int, typer.Option()] = 1080,
    screen_height: Annotated[int, typer.Option()] = 1920,
    pixels: Annotated[int, typer.Option(help="drag length per probe swipe")] = 400,
    set_zoom: Annotated[bool, typer.Option(help="clamp out and step back in first")] = True,
) -> None:
    """Measure what a swipe does to the map, here and now.

    Prints what a sweep would plan from, and refuses out loud when the answer
    is not something a sweep can use. Run it on its own before trusting a
    sweep, and KEEP HANDS OFF THE EMULATOR while it runs: a probe taken while
    somebody else is panning is exactly the contaminated measurement this
    whole approach exists to stop relying on.

    Slow on purpose. Capture writes the journal some tens of seconds behind
    the wire, so each half waits that out rather than pretending otherwise.
    """
    policy = AdbPolicy.resolved(adb)
    target = policy.collector_serial
    try:
        policy.check_target(target)
    except AdbGuardError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    assert target is not None

    screen = zoom_mod.Screen(width=screen_width, height=screen_height)
    centre = (screen_width / 2, screen_height * 0.47)
    path = db or Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db"))
    journal = Journal(path)
    journal.init_db()
    client = AdbClient(policy=policy, serial=target, executable=adb)
    last: probe_mod.Viewport | None = None
    measured: dict[str, probe_mod.AxisEffect] = {}
    try:
        if set_zoom:
            typer.echo(f"{target}: clamping to max zoom out, then one step in")
            for _ in range(3):
                zoom_mod.send(adb, policy, target, zoom_mod.out_script(screen, centre, 300))
                time.sleep(1.5)
            zoom_mod.send(adb, policy, target, zoom_mod.in_script(screen, centre, 300))
            time.sleep(4.0)

        for name, delta in (("horizontal", (pixels, 0)), ("vertical", (0, pixels))):
            mark = journal.watermark()
            since = datetime.now(UTC)
            cx, cy = centre
            typer.echo(f"{name}: {probe_mod.PROBE_SWIPES} swipes of {pixels}px")
            for _ in range(probe_mod.PROBE_SWIPES):
                client.swipe(
                    int(cx + delta[0] / 2),
                    int(cy + delta[1] / 2),
                    int(cx - delta[0] / 2),
                    int(cy - delta[1] / 2),
                    duration_ms=1200,
                )
                time.sleep(3.0)
            typer.echo("  waiting for the journal to catch up")
            seen = probe_mod.settled(journal, mark, since, want=2, timeout=150.0)
            if len(seen) < 2:
                typer.echo(
                    f"  only {len(seen)} pan(s) reached the journal; is dw-capture running"
                    " and is the map on screen?",
                    err=True,
                )
                raise typer.Exit(code=1)
            measured[name] = probe_mod.effect_of(seen[0], seen[-1], pixels, probe_mod.PROBE_SWIPES)
            last = seen[-1]
            typer.echo(
                f"  {seen[0].x},{seen[0].y} -> {seen[-1].x},{seen[-1].y}"
                f"  viewLvl={seen[-1].view_lvl}  objects={seen[-1].objects}"
            )
    finally:
        journal.close()

    assert last is not None
    result = probe_mod.Probe(
        horizontal=measured["horizontal"],
        vertical=measured["vertical"],
        view_lvl=last.view_lvl if last.view_lvl is not None else -1,
        at_x=last.x,
        at_y=last.y,
    )
    typer.echo("")
    for name, effect in (("horizontal", result.horizontal), ("vertical", result.vertical)):
        typer.echo(
            f"  {name:<10} drives map {effect.axis}"
            f"  {effect.tiles_per_pixel:+.4f} tiles/px"
            f"  (cross {effect.cross_tiles_per_pixel:+.4f})"
        )
    typer.echo(f"  camera     {result.at_x},{result.at_y}  viewLvl {result.view_lvl}")
    try:
        result.check()
    except probe_mod.ProbeError as exc:
        typer.echo(f"\nNOT SWEEPABLE: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo("\nsweepable")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
