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
from dw_collector.ui_worker import sweep as sweep_mod
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


def _resolve(adb: str) -> tuple[AdbPolicy, str]:
    policy = AdbPolicy.resolved(adb)
    try:
        target = policy.check_target(policy.collector_serial)
    except AdbGuardError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    return policy, target


def _measure(
    *,
    adb: str,
    policy: AdbPolicy,
    target: str,
    journal: Journal,
    client: AdbClient,
    screen: zoom_mod.Screen,
    centre: tuple[float, float],
    pixels: int,
    set_zoom: bool,
) -> probe_mod.Probe:
    """Set the zoom if asked, then measure both axes. Shared by both commands.

    A sweep is not offered a way to skip this. Skipping is how the silent
    failures get back in: a route planned from last week's numbers, run on a
    map somebody left at viewLvl 2, would swipe the whole way, see nothing go
    wrong, and collect not one tile.
    """
    if set_zoom:
        # CLAMP, STEP IN, AND CHECK. zoom.py has always said this is the only
        # way to reach a known zoom, and the first implementation clamped and
        # stepped in exactly once without checking. It worked three runs in a
        # row and then did not: one gesture is worth an unknown number of the
        # game's own zoom steps, so from some starting zooms a single step in
        # leaves the map at viewLvl 2 — where the game draws a normal-looking
        # map and the server sends no tiles at all.
        #
        # The check is the same signal the sweep runs on: swipe, and see
        # whether a pan comes back. At viewLvl 2 none does.
        #
        # THERE AND BACK, on both axes, because "no pan" has a second cause
        # that looks identical: a camera pinned against the edge of the world
        # does not move, so it emits nothing however good the zoom is. The
        # first version of this check swiped one way, found nothing, and
        # blamed the zoom — while the real reason was that the previous
        # sweep had left the camera in the corner. Four swipes that cancel
        # out cannot all be against an edge.
        typer.echo(f"{target}: clamping to max zoom out")
        for _ in range(4):
            zoom_mod.send(adb, policy, target, zoom_mod.out_script(screen, centre, 300))
            time.sleep(1.5)
        cx, cy = centre
        for attempt in range(1, 9):
            # SMALL STEPS. A full-spread pinch is worth an unknown number of
            # the game's own zoom steps, and stepping in with one went past
            # the world map entirely and into the player's base — where there
            # is no map, so no pan, which looks exactly like being zoomed too
            # far OUT. Both ends of the range report the same silence.
            #
            # Clamping out is the one state that can be reached without
            # counting, so the walk starts there and creeps in: the FIRST
            # zoom that answers with a pan is viewLvl 1, because 2 is silent
            # and 0 is further in still.
            zoom_mod.send(adb, policy, target, zoom_mod.pinch_script(screen, centre, 200, 260))
            time.sleep(3.0)
            mark = journal.watermark()
            since = datetime.now(UTC)
            for dx, dy in ((300, 0), (-300, 0), (0, 300), (0, -300)):
                client.swipe(
                    int(cx + dx / 2),
                    int(cy + dy / 2),
                    int(cx - dx / 2),
                    int(cy - dy / 2),
                    duration_ms=1200,
                )
                time.sleep(1.5)
            found = probe_mod.settled(journal, mark, since, want=1, timeout=90.0)
            levels = [v.view_lvl for v in found]
            typer.echo(f"  step in {attempt}: pans={len(found)} viewLvl={levels}")
            if probe_mod.SWEEP_VIEW_LEVEL in levels:
                break
        else:
            typer.echo(
                "no zoom between max-out and eight steps in returned a tile."
                " Either the world map is not the screen that is open, or"
                " dw-capture is not running — both look like this.",
                err=True,
            )
            raise typer.Exit(code=1)

    # STEP AWAY FROM THE WALL BEFORE MEASURING. The probe swipes one way,
    # repeatedly, because it is measuring a SIGN and so cannot cancel itself
    # out. A camera against the edge of the world does not move, so those
    # swipes emit nothing and the probe reads it as "the map is not on
    # screen" — which is what happened, with the camera at 987,184 because
    # the previous sweep had left it in the corner.
    #
    # The retreat is as long as the probe's own run, and in the opposite
    # direction on each axis, so the probe has a full measurement's worth of
    # room ahead of it. Sized rather than fixed: at PROBE_SWIPES 4 a pair
    # sufficed, at 8 the probe travels twice as far and would have run into
    # the wall it had just stepped away from.
    cx, cy = centre
    retreat = [(-300, 0)] * probe_mod.PROBE_SWIPES + [(0, -300)] * probe_mod.PROBE_SWIPES
    for dx, dy in retreat:
        client.swipe(
            int(cx + dx / 2), int(cy + dy / 2), int(cx - dx / 2), int(cy - dy / 2), duration_ms=1200
        )
        time.sleep(1.5)

    measured: dict[str, probe_mod.AxisEffect] = {}
    last: probe_mod.Viewport | None = None
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

    assert last is not None
    return probe_mod.Probe(
        horizontal=measured["horizontal"],
        vertical=measured["vertical"],
        view_lvl=last.view_lvl if last.view_lvl is not None else -1,
        at_x=last.x,
        at_y=last.y,
    )


def _report(result: probe_mod.Probe) -> None:
    for name, effect in (("horizontal", result.horizontal), ("vertical", result.vertical)):
        typer.echo(
            f"  {name:<10} drives map {effect.axis}"
            f"  {effect.tiles_per_pixel:+.4f} tiles/px"
            f"  (cross {effect.cross_tiles_per_pixel:+.4f})"
        )
    typer.echo(f"  camera     {result.at_x},{result.at_y}  viewLvl {result.view_lvl}")


def _open_journal(db: Path | None) -> Journal:
    journal = Journal(db or Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db")))
    journal.init_db()
    return journal


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
    policy, target = _resolve(adb)
    screen = zoom_mod.Screen(width=screen_width, height=screen_height)
    centre = (screen_width / 2, screen_height * 0.47)
    journal = _open_journal(db)
    try:
        result = _measure(
            adb=adb,
            policy=policy,
            target=target,
            journal=journal,
            client=AdbClient(policy=policy, serial=target, executable=adb),
            screen=screen,
            centre=centre,
            pixels=pixels,
            set_zoom=set_zoom,
        )
    finally:
        journal.close()

    typer.echo("")
    _report(result)
    try:
        result.check()
    except probe_mod.ProbeError as exc:
        typer.echo(f"\nNOT SWEEPABLE: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo("\nsweepable")


@app.command()
def sweep(
    adb: Annotated[str, _ADB] = "adb",
    db: Annotated[Path | None, typer.Option("--db")] = None,
    screen_width: Annotated[int, typer.Option()] = 1080,
    screen_height: Annotated[int, typer.Option()] = 1920,
    max_swipes: Annotated[
        int | None, typer.Option(help="stop after this many swipes; for a bounded trial")
    ] = None,
    settle_seconds: Annotated[float, typer.Option(help="pause after each swipe")] = 3.0,
    check_every: Annotated[int, typer.Option(help="re-check the map this often, in swipes")] = 25,
    wait_for_idle_seconds: Annotated[
        float, typer.Option(help="wait this long for the operator to stop using the machine")
    ] = 900.0,
) -> None:
    """Sweep the map the collector is currently on, then say what it covered.

    THE MAP IT IS CURRENTLY ON. The server is the game's to choose and moving
    between server maps is a separate UI flow that does not exist yet, so this
    covers one server per run and the operator picks which by putting the
    collector there.

    The route is planned from a probe taken at the start, never from stored
    numbers — probe.py records the two live runs that disagreed about which
    axis a swipe even moves.

    IT DOES NOT TRUST ITSELF TO KEEP WORKING. Every `check_every` swipes it
    asks the journal whether pans are still arriving and still at viewLvl 1,
    and stops when they are not. A sweep whose map got closed, or whose zoom
    drifted to the level that returns no tiles, would otherwise finish its
    whole route and report success over ground it never read.
    """
    policy, target = _resolve(adb)
    screen = zoom_mod.Screen(width=screen_width, height=screen_height)
    centre = (screen_width / 2, screen_height * 0.47)
    journal = _open_journal(db)
    client = AdbClient(policy=policy, serial=target, executable=adb)
    idle = IdlePolicy.from_env()
    started = journal.watermark()
    since = datetime.now(UTC)
    done = 0
    seen: list[probe_mod.Viewport] = []

    # WAIT FOR THE MACHINE, DO NOT REFUSE IT. The idle gate is there so a
    # half-hour sweep yields when the operator comes back — but checked before
    # the first swipe it can never pass, because the operator has just typed
    # the command that started it. The first real run measured both axes over
    # five minutes and then quit having swiped nothing: "idle 34s < 60s".
    #
    # Waiting also covers the probe, which drives the device just as hard and
    # was doing so while the machine was still in use.
    if idle is not None:
        deadline = time.monotonic() + wait_for_idle_seconds
        state = idle.evaluate()
        if not state.is_idle:
            typer.echo(
                f"waiting up to {wait_for_idle_seconds:.0f}s for the machine to go idle"
                f" ({state.reason})"
            )
        while not state.is_idle and time.monotonic() < deadline:
            time.sleep(5.0)
            state = idle.evaluate()
        if not state.is_idle:
            typer.echo(f"still in use after {wait_for_idle_seconds:.0f}s: {state.reason}", err=True)
            journal.close()
            raise typer.Exit(code=1)

    try:
        result = _measure(
            adb=adb,
            policy=policy,
            target=target,
            journal=journal,
            client=client,
            screen=screen,
            centre=centre,
            pixels=400,
            set_zoom=True,
        )
        typer.echo("")
        _report(result)
        try:
            result.check()
        except probe_mod.ProbeError as exc:
            typer.echo(f"\nNOT SWEEPABLE: {exc}", err=True)
            raise typer.Exit(code=1) from exc

        plan = sweep_mod.plan_from_probe(
            result.horizontal.tiles_per_pixel,
            result.vertical.tiles_per_pixel,
            result.horizontal.axis,
            # WHERE THE CAMERA ACTUALLY IS. The route marches one way along
            # its rows and one way down them, so it only sweeps the map if it
            # starts at the corner it marches away from; from the position
            # the probe reported here once, the same 466 swipes would have
            # covered 72 of 400 cells and spent the rest against an edge.
            start=(result.at_x, result.at_y),
            screen_width=screen_width,
            screen_height=screen_height,
        )
        route = plan.swipes if max_swipes is None else plan.swipes[:max_swipes]
        minutes = len(route) * (settle_seconds + 0.6) / 60
        typer.echo(
            f"\nplan: {plan.homing} swipes to reach the corner from"
            f" {result.at_x},{result.at_y}, then {plan.rows} rows x {plan.per_row}"
            f" = {len(plan.swipes)} total ({len(route)} to run, about {minutes:.0f} min)"
        )

        for index, step in enumerate(route, start=1):
            if policy.kill_switch_engaged():
                typer.echo(f"\nkill switch engaged after {done} swipes", err=True)
                break
            # A sweep runs for half an hour, which is long enough that the
            # operator will come back to the machine partway through. Their
            # input and the sweep's would fight over the same screen, and the
            # sweep would win — so it yields.
            if idle is not None:
                state = idle.evaluate()
                if not state.is_idle:
                    typer.echo(f"\nstopped after {done} swipes: {state.reason}")
                    break
            client.swipe(step.from_x, step.from_y, step.to_x, step.to_y, duration_ms=1200)
            done += 1
            time.sleep(settle_seconds)
            if index % check_every == 0:
                recent = probe_mod.parse_viewports(
                    journal.payloads_after(started, sweep_mod.MAP_COMMAND, since)
                )
                levels = {v.view_lvl for v in recent[-5:]}
                typer.echo(
                    f"  {index}/{len(route)}  pans so far {len(recent)}"
                    f"  viewLvl {sorted(x for x in levels if x is not None)}"
                )
                if recent and probe_mod.SWEEP_VIEW_LEVEL not in levels:
                    typer.echo(
                        f"\nthe map is no longer at viewLvl {probe_mod.SWEEP_VIEW_LEVEL};"
                        f" stopping after {done} swipes rather than sweeping blind",
                        err=True,
                    )
                    break

        seen = probe_mod.parse_viewports(
            journal.payloads_after(started, sweep_mod.MAP_COMMAND, since)
        )
    finally:
        journal.close()

    typer.echo(f"\nswipes={done} pans={len(seen)}")
    box = sweep_mod.covered([(v.x, v.y) for v in seen])
    if box is None:
        typer.echo("no pans at all — nothing was covered", err=True)
        raise typer.Exit(code=1)
    typer.echo(f"camera visited x {box[0]}..{box[1]}  y {box[2]}..{box[3]}")
    typer.echo(
        "\nwhat was actually covered is world_sweep_coverage, once sync catches up."
        " The box above is where the camera went, which is not the same claim."
    )


def main() -> None:
    app()


if __name__ == "__main__":
    main()
