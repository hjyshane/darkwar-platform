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
from dw_collector.ui_worker import gaps as gaps_mod
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


#: Step-ins from a clamped-out map before the zoom is expected to be right.
#:
#: Measured, not chosen: every live run has reached viewLvl 1 on the third,
#: with the first two silent because viewLvl 2 returns no tiles. Sending all
#: three without checking between them is what lets the whole setup cost ONE
#: journal wait instead of three.
ZOOM_STEPS = 3


def _blind_zoom(
    *,
    adb: str,
    policy: AdbPolicy,
    target: str,
    client: AdbClient,
    screen: zoom_mod.Screen,
    centre: tuple[float, float],
    steps: int = ZOOM_STEPS,
    label: str = "",
) -> None:
    """Clamp out, then step in `steps` times WITHOUT looking in between.

    CLAMP, STEP IN, AND CHECK — but check once at the end rather than after
    every step. The checking is what costs: a look at the journal is 40-90
    seconds because capture writes it that far behind the wire, and the old
    walk paid that up to three times before the probe had even started.

    Sending the steps blind is safe because the sequence is not a guess.
    Clamping out is reachable without counting, and from there every live run
    has landed on viewLvl 1 at the third step, the first two being silent
    because viewLvl 2 returns no tiles at all. The single read afterwards
    still confirms it, and still refuses if it did not happen.

    A couple of swipes after each step keep the camera moving so the client
    keeps asking for tiles; without them a step that DID reach a usable zoom
    would emit nothing and read as a step that did not.
    """
    prefix = f"{label}: " if label else ""
    typer.echo(f"{prefix}{target}: clamping out, then {steps} steps in")
    for _ in range(4):
        zoom_mod.send(adb, policy, target, zoom_mod.out_script(screen, centre, 300))
        time.sleep(1.0)
    cx, cy = centre
    for _ in range(steps):
        zoom_mod.send(adb, policy, target, zoom_mod.pinch_script(screen, centre, 200, 260))
        time.sleep(2.0)
        # There and back, so a camera against an edge still moves one way.
        for dx in (300, -300):
            client.swipe(int(cx + dx / 2), int(cy), int(cx - dx / 2), int(cy), duration_ms=1200)
            time.sleep(1.0)


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
    swipe_ms: int = 1200,
) -> probe_mod.Probe:
    """Set the zoom and measure both axes, for ONE journal wait.

    The old shape asked the journal after every zoom step and after each probe
    axis — five waits at 40-90 seconds each, four to nine minutes before a
    single sweeping swipe. The waits were the cost, not the gestures.

    They are also all reads of the SAME stream. So everything is sent first
    and read once at the end, split by wall clock: the zoom steps, then the
    horizontal probe, then the vertical one. `captured_at` is wire time, which
    is what those boundaries are in.

    A sweep is still not offered a way to skip this. Skipping is how the silent
    failures get back in: a route planned from last week's numbers, run on a
    map somebody left at viewLvl 2, would swipe the whole way, see nothing go
    wrong, and collect not one tile.
    """
    mark = journal.watermark()
    since = datetime.now(UTC)

    if set_zoom:
        _blind_zoom(
            adb=adb, policy=policy, target=target, client=client, screen=screen, centre=centre
        )

    # STEP AWAY FROM THE WALL BEFORE MEASURING. The probe swipes one way,
    # repeatedly, because it is measuring a SIGN and so cannot cancel itself
    # out. A camera against the edge of the world does not move, so those
    # swipes emit nothing and the probe reads it as "the map is not on
    # screen" — which is what happened once, with the camera at 987,184
    # because the previous sweep had left it in the corner.
    cx, cy = centre
    for dx, dy in [(-300, 0)] * probe_mod.PROBE_SWIPES + [(0, -300)] * probe_mod.PROBE_SWIPES:
        client.swipe(
            int(cx + dx / 2),
            int(cy + dy / 2),
            int(cx - dx / 2),
            int(cy - dy / 2),
            duration_ms=swipe_ms,
        )
        time.sleep(0.8)

    bounds: dict[str, tuple[datetime, datetime]] = {}
    for name, delta in (("horizontal", (pixels, 0)), ("vertical", (0, pixels))):
        opened = datetime.now(UTC)
        typer.echo(f"{name}: {probe_mod.PROBE_SWIPES} swipes of {pixels}px")
        for _ in range(probe_mod.PROBE_SWIPES):
            client.swipe(
                int(cx + delta[0] / 2),
                int(cy + delta[1] / 2),
                int(cx - delta[0] / 2),
                int(cy - delta[1] / 2),
                duration_ms=swipe_ms,
            )
            time.sleep(1.2)
        bounds[name] = (opened, datetime.now(UTC))

    typer.echo("waiting for the journal, once")
    stream = probe_mod.settled(journal, mark, since, want=2, timeout=300.0)
    if len(stream) < 2:
        typer.echo(
            f"only {len(stream)} pan(s) reached the journal; is dw-capture running"
            " and is the world map the screen that is open?",
            err=True,
        )
        raise typer.Exit(code=1)

    measured: dict[str, probe_mod.AxisEffect] = {}
    for name, (opened, closed) in bounds.items():
        window = [v for v in stream if opened <= v.at <= closed]
        if len(window) < 2:
            typer.echo(
                f"{name}: {len(window)} pan(s) in its window — not enough to measure from",
                err=True,
            )
            raise typer.Exit(code=1)
        measured[name] = probe_mod.effect_of(window[0], window[-1], pixels, probe_mod.PROBE_SWIPES)
        typer.echo(
            f"  {name}: {window[0].x},{window[0].y} -> {window[-1].x},{window[-1].y}"
            f"  viewLvl={window[-1].view_lvl}  pans={len(window)}"
        )

    last = stream[-1]
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
    fill_gaps: Annotated[
        int | None,
        typer.Option(help="sweep only what this server's map is still missing, not the whole map"),
    ] = None,
    quiet_from_minute: Annotated[
        int,
        typer.Option(help="stop once the clock passes this minute of the hour, for the :58 macro"),
    ] = 55,
    swipe_ms: Annotated[
        int,
        typer.Option(
            help="how long each swipe takes; shorter is a fling and travels further per swipe"
        ),
    ] = 1200,
    region: Annotated[
        str | None,
        typer.Option(help="sweep only this box, as x0,x1,y0,y1 — e.g. 400,700,300,600"),
    ] = None,
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
        state = idle.contends()
        if not state.is_idle:
            typer.echo(
                f"waiting up to {wait_for_idle_seconds:.0f}s for the machine to go idle"
                f" ({state.reason})"
            )
        while not state.is_idle and time.monotonic() < deadline:
            time.sleep(5.0)
            state = idle.contends()
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
            swipe_ms=swipe_ms,
        )
        typer.echo("")
        _report(result)
        try:
            result.check()
        except probe_mod.ProbeError as exc:
            typer.echo(f"\nNOT SWEEPABLE: {exc}", err=True)
            raise typer.Exit(code=1) from exc

        targets: list[tuple[tuple[int, int, int, int] | None, sweep_mod.SweepPlan]] = []
        box: tuple[int, int, int, int] | None = None
        if region is not None:
            # A WHOLE MAP DOES NOT FIT IN FIVE MINUTES and pretending otherwise
            # is how a partial sweep gets read as a complete one. 162 pans is
            # the floor for 1000x1000 at a 71x140 viewport, and that is with
            # perfect packing; the budget buys about two thirds of it. Naming a
            # box is how a five-minute answer becomes a complete one about the
            # ground that matters.
            try:
                x0, x1, y0, y1 = (int(part) for part in region.split(","))
            except ValueError as exc:
                typer.echo(f"--region wants x0,x1,y0,y1 — got {region!r}", err=True)
                raise typer.Exit(code=2) from exc
            box = (x0, x1, y0, y1)
            typer.echo(f"region: x {x0}..{x1}  y {y0}..{y1}")
        if fill_gaps:
            # A CELL IS COVERED BY ONE VIEWPORT, NOT BY A SWEEP. The coverage
            # view asks whether some pan's window contained the cell's centre,
            # and the window is 71 x 140 tiles — so filling a gap is arriving
            # somewhere once, within 35 tiles across and 70 down.
            #
            # This used to plan a padded box and sweep it, and three passes
            # showed how that goes: the box needs padding, the padding needs a
            # margin, the margin needs the landing point, and each correction
            # opened the next while the same cells stayed unread. The last one
            # ran 105 swipes over y 25..974 for two regions inside y 550..949
            # and gained one cell.
            #
            # AND IT LOOKS AT WHERE IT LANDED. Open-loop hops assumed each one
            # arrived and chained from the target rather than the position, so
            # a systematic error compounded: a run aimed at three cells landed
            # +111 tiles off in x on two of them while y was out by 0 and -5.
            # The horizontal measurement is still low by about a third, which
            # no amount of arithmetic here can know — but one look at the
            # journal can.
            missed = sorted(gaps_mod.missing_cells(journal.conn, fill_gaps))
            typer.echo(f"\n{len(missed)} cells never covered on {fill_gaps}")
            filled = 0
            for gx, gy in missed:
                point = (
                    gx * gaps_mod.CELL + gaps_mod.CELL // 2,
                    gy * gaps_mod.CELL + gaps_mod.CELL // 2,
                )
                at = (result.at_x, result.at_y)
                for attempt in range(1, 4):
                    if (
                        abs(at[0] - point[0]) <= sweep_mod.REACH_X
                        and abs(at[1] - point[1]) <= sweep_mod.REACH_Y
                    ):
                        typer.echo(f"  {point[0]},{point[1]}: reached (at {at[0]},{at[1]})")
                        filled += 1
                        break
                    hop = sweep_mod.approach(
                        at,
                        point,
                        result.horizontal.tiles_per_pixel,
                        result.vertical.tiles_per_pixel,
                        result.horizontal.axis,
                        screen_width=screen_width,
                        screen_height=screen_height,
                    )
                    typer.echo(
                        f"  {point[0]},{point[1]}: try {attempt} from {at[0]},{at[1]}"
                        f" — {len(hop)} swipes"
                    )
                    mark = journal.watermark()
                    hop_since = datetime.now(UTC)
                    for step in hop:
                        client.swipe(
                            step.from_x, step.from_y, step.to_x, step.to_y, duration_ms=swipe_ms
                        )
                        done += 1
                        time.sleep(settle_seconds)
                    arrived = probe_mod.settled(journal, mark, hop_since, want=1, timeout=150.0)
                    if not arrived:
                        typer.echo("    no pan came back; giving up on this cell", err=True)
                        break
                    at = (arrived[-1].x, arrived[-1].y)
            typer.echo(f"\nswipes={done} reached {filled}/{len(missed)} cells")
            typer.echo(
                "world_sweep_coverage has the verdict once sync catches up;"
                " reaching a cell's centre is what makes it covered."
            )
            journal.close()
            return
        else:
            targets.append(
                (
                    None,
                    sweep_mod.plan_from_probe(
                        result.horizontal.tiles_per_pixel,
                        result.vertical.tiles_per_pixel,
                        result.horizontal.axis,
                        # WHERE THE CAMERA ACTUALLY IS. The route marches one way
                        # along its rows and one way down them, so it only sweeps
                        # the map if it starts at the corner it marches away from;
                        # from the position the probe reported here once, the same
                        # 466 swipes would have covered 72 of 400 cells and spent
                        # the rest against an edge.
                        start=(result.at_x, result.at_y),
                        screen_width=screen_width,
                        screen_height=screen_height,
                        region=box,
                    ),
                )
            )

        plan = targets[0][1]
        every = [(region, step) for region, target in targets for step in target.swipes]
        route = every if max_swipes is None else every[:max_swipes]
        minutes = len(route) * (settle_seconds + 0.6) / 60
        typer.echo(
            f"\nplan: {len(targets)} route(s) from {result.at_x},{result.at_y},"
            f" first is {plan.homing} homing + {plan.rows} rows x {plan.per_row}"
            f" — {len(every)} swipes total ({len(route)} to run, about {minutes:.0f} min)"
        )

        pending = list(route)
        index = 0
        needs_rezoom = False
        while pending:
            box, step = pending.pop(0)
            index += 1
            if policy.kill_switch_engaged():
                typer.echo(f"\nkill switch engaged after {done} swipes", err=True)
                break
            # THE MACRO OWNS THE TOP OF THE HOUR. Something else drives this
            # emulator at :58, and a sweep runs long enough to still be going
            # when it arrives — the two would fight over one screen and both
            # would lose.
            #
            # It stands down and comes back rather than giving up. A sweep of
            # a whole server is half an hour against a 55-minute window, so
            # ending at the boundary would leave a run started at :40 with a
            # quarter of the map done and no way to finish it in one go.
            if datetime.now().minute >= quiet_from_minute:
                typer.echo(
                    f"\n  :{datetime.now().minute:02d} — standing down for the macro after"
                    f" {done} swipes; resuming after the hour"
                )
                while datetime.now().minute >= quiet_from_minute:
                    time.sleep(20.0)
                # The macro drove the emulator while this waited, so the zoom
                # and the camera are wherever it left them. Putting this swipe
                # back and forcing a reset runs the same recovery the drift
                # path uses — which is what makes waiting safe rather than
                # merely convenient.
                pending = [(box, step), *pending]
                index = check_every - 1
                needs_rezoom = True
                continue
            # A sweep runs for half an hour, long enough that the operator
            # comes back partway through. `contends` rather than `evaluate`:
            # the fight is over the emulator's window, not the machine, and
            # gating on the whole machine going quiet made the sweep
            # unrunnable — six minutes of probe, seven swipes, "idle 0s".
            if idle is not None:
                state = idle.contends()
                if not state.is_idle:
                    typer.echo(f"\nstopped after {done} swipes: {state.reason}")
                    break
            client.swipe(step.from_x, step.from_y, step.to_x, step.to_y, duration_ms=swipe_ms)
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
                if needs_rezoom or (recent and probe_mod.SWEEP_VIEW_LEVEL not in levels):
                    # THE ZOOM DRIFTS. One run reached swipe 1,350 and found
                    # the map back at viewLvl 0. Stopping there was safe but
                    # threw away the rest of the route for a condition that
                    # can simply be corrected.
                    needs_rezoom = False
                    typer.echo("\n  resetting the zoom and re-planning this region")
                    # The zoom walk is not separable from the measurement any
                    # more: both are answered by one read of the same stream.
                    # Re-measuring here is not waste — the camera has moved and
                    # the zoom has changed, so the numbers are stale anyway.
                    try:
                        again = _measure(
                            adb=adb,
                            policy=policy,
                            target=target,
                            journal=journal,
                            client=client,
                            screen=screen,
                            centre=centre,
                            pixels=400,
                            set_zoom=True,
                            swipe_ms=swipe_ms,
                        )
                        again.check()
                    except (typer.Exit, probe_mod.ProbeError):
                        typer.echo(
                            f"\ncould not get back to a zoom that returns tiles;"
                            f" stopping after {done} swipes rather than sweeping blind",
                            err=True,
                        )
                        break
                    result = again
                    landed = probe_mod.Viewport(
                        at=datetime.now(UTC),
                        x=again.at_x,
                        y=again.at_y,
                        view_lvl=again.view_lvl,
                        objects=0,
                    )
                    # RE-PLAN, DO NOT JUST CONTINUE. Setting the zoom pans the
                    # camera — that is what pinch does here — so the rest of a
                    # route planned from the old position would sweep the
                    # wrong ground while reporting every swipe. The device has
                    # not changed, so the measured axes still hold; only the
                    # starting point has moved.
                    replanned = sweep_mod.plan_from_probe(
                        result.horizontal.tiles_per_pixel,
                        result.vertical.tiles_per_pixel,
                        result.horizontal.axis,
                        start=(landed.x, landed.y),
                        screen_width=screen_width,
                        screen_height=screen_height,
                        region=box,
                    )
                    remaining = [(r, st) for r, st in pending if r != box]
                    pending = [(box, st) for st in replanned.swipes] + remaining
                    typer.echo(
                        f"  re-planned from {landed.x},{landed.y}:"
                        f" {len(replanned.swipes)} swipes for this region,"
                        f" {len(remaining)} after it"
                    )

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
