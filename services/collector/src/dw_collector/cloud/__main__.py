"""dw-cloud: the unattended collector on one cloud VM.

    emulator (adb) -> tcpdump chunks -> ingest-dir -> dw-sync -> Supabase
                          ^                                        |
                          +---- watchdog: restart the game --------+

One process, like `dw-iphone`: the capture supervisor, the ingest and sync
children, and the watchdog loop. The emulator itself is its own service
(`dw-emulator`) and is not started here.

The watchdog restarts ONLY the game client, on the one adb serial it is told
about, and only when that serial is the sole device the VM's adb can see.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import structlog

from dw_collector.cloud.device import AdbDevice
from dw_collector.cloud.feed import SignalFeed, last_packet_at
from dw_collector.cloud.game import AdbGameClient
from dw_collector.cloud.routines import is_paused, run_due
from dw_collector.cloud.schedule import Schedule
from dw_collector.cloud.tcpdump import DEFAULT_FILTER, TcpdumpBackend, default_interface
from dw_collector.envfile import load_env_file
from dw_collector.iphone.__main__ import child_specs, data_dir
from dw_collector.iphone.children import ChildGroup
from dw_collector.iphone.supervisor import IphoneConfig, Supervisor, recover_parts
from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.adb import AdbClient, list_devices, wait_for_serial
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy
from dw_collector.watchdog.machine import Alert, State, Watchdog, WatchdogConfig
from dw_collector.watchdog.update_signal import UpdateObserver

log = structlog.get_logger()

TICK_SECONDS = float(os.environ.get("DW_CLOUD_TICK_SECONDS", "30"))
#: After a launch the client logs in, then loads for a while with the city not
#: yet tappable; a routine run in that window fails for no real reason.
WARMUP_SECONDS = float(os.environ.get("DW_CLOUD_WARMUP_SECONDS", "240"))


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def _minutes(name: str, default: float) -> float:
    return float(os.environ.get(name, str(default)))


def _control(argv: list[str]) -> bool:
    """`pause`, `resume`, `status`: handled without starting the service."""
    if not argv or argv[0] not in {"pause", "resume", "status"}:
        return False
    base = data_dir()
    pause_file = base / "cloud-pause"
    if argv[0] == "pause":
        pause_file.write_text(datetime.now(tz=UTC).isoformat(), encoding="utf-8")
        print("paused: the service closes the game within a tick; log in by hand")
    elif argv[0] == "resume":
        pause_file.unlink(missing_ok=True)
        print("resumed: the service relaunches the game within a tick")
    else:
        print("paused" if pause_file.exists() else "running")
        db = base / "cloud-routines.db"
        if db.exists():
            print(json.dumps(Schedule(db).snapshot(), indent=2))
    return True


def main() -> None:
    if _control(sys.argv[1:]):
        return
    base = data_dir()
    if not os.environ.get("DW_ENV_FILE") and (base / ".env").is_file():
        os.environ["DW_ENV_FILE"] = str(base / ".env")
    load_env_file()

    capture_dir = Path(os.environ.get("DW_CLOUD_DIR", str(base / "cloud")))
    journal_path = Path(os.environ.get("DW_CLOUD_DB", str(base / "cloud.db")))
    alerts_file = base / "cloud-alerts.jsonl"
    halted_file = base / "cloud-halted.json"
    resume_file = base / "cloud-resume"
    pause_file = base / "cloud-pause"
    capture_dir.mkdir(parents=True, exist_ok=True)

    adb = os.environ.get("DW_CLOUD_ADB", "adb")
    serial = os.environ.get("DW_CLOUD_SERIAL", "emulator-5554")
    package = os.environ.get("DW_CLOUD_PACKAGE", "com.readygo.dark.gp")
    interface = os.environ.get("DW_CLOUD_INTERFACE") or default_interface()
    if interface is None:
        sys.exit("dw-cloud: cannot read the default route; set DW_CLOUD_INTERFACE")

    # 60 s chunks: the journal only learns of a login when its chunk is
    # published, so the watchdog's picture of the game lags by about one chunk.
    config = IphoneConfig(
        directory=capture_dir,
        chunk_seconds=float(os.environ.get("DW_CLOUD_CHUNK_SECONDS", "60")),
        overlap_seconds=float(os.environ.get("DW_CLOUD_OVERLAP_SECONDS", "10")),
    )
    backend = TcpdumpBackend(
        interface,
        executable=os.environ.get("DW_CLOUD_TCPDUMP", "tcpdump"),
        bpf=os.environ.get("DW_CLOUD_FILTER", DEFAULT_FILTER),
    )

    stop = threading.Event()

    def _stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    recovered = recover_parts(capture_dir)
    if recovered:
        log.info("cloud.recovered_parts", count=recovered)

    journal = Journal(journal_path)
    journal.init_db()
    children = ChildGroup(child_specs(capture_dir, journal_path))
    children.start()
    supervisor = Supervisor(config, backend, tag="cloud")
    runner = threading.Thread(target=supervisor.run, args=(stop.is_set,), name="cloud-capture")
    runner.daemon = True
    runner.start()
    log.info(
        "cloud.start",
        interface=interface,
        directory=str(capture_dir),
        journal=str(journal_path),
        chunk_seconds=config.chunk_seconds,
        restarts=not _flag("DW_CLOUD_NO_RESTART"),
    )

    watchdog: Watchdog | None = None
    game: AdbGameClient | None = None
    device: AdbDevice | None = None
    schedule = Schedule(base / "cloud-routines.db")
    was_paused = False
    #: No routines until the client has had time to finish loading after a launch.
    warmup_until = time.monotonic() + WARMUP_SECONDS
    feed: SignalFeed | None = None
    if not _flag("DW_CLOUD_NO_RESTART"):
        if not wait_for_serial(serial, executable=adb, timeout_seconds=300.0):
            log.error("cloud.emulator_never_appeared", serial=serial)
            stop.set()
        policy = AdbPolicy(
            collector_serial=serial,
            denylist=frozenset(),
            kill_switch_file=_kill_switch(),
            enumerated=True,
        )
        observer = UpdateObserver()
        feed = SignalFeed(journal, observer)
        adb_client = AdbClient(policy, serial, executable=adb)
        device = AdbDevice(adb_client)
        game = AdbGameClient(
            adb_client,
            package,
            journal,
            login_timeout_seconds=float(os.environ.get("DW_CLOUD_LOGIN_TIMEOUT", "300")),
            devices=lambda: list_devices(adb),
        )

        def write_alert(kind: str, detail: str) -> None:
            line = {"at": datetime.now(tz=UTC).isoformat(), "kind": kind, "detail": detail}
            log.warning("cloud.alert", **line)
            with alerts_file.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(line) + "\n")
            if kind == "halted":
                halted_file.write_text(json.dumps(line), encoding="utf-8")

        def alert(item: Alert) -> None:
            write_alert(item.kind, item.detail)

        watchdog = Watchdog(
            WatchdogConfig(
                stall_after=timedelta(minutes=_minutes("DW_CLOUD_STALL_MINUTES", 10)),
                auto_restart_on_signal=_flag("DW_CLOUD_AUTO_RESTART_ON_SIGNAL"),
            ),
            game,
            last_packet_at=lambda: last_packet_at(journal),
            signals=feed.poll,
            now=lambda: datetime.now(tz=UTC),
            alert=alert,
            on_restart=observer.restarted,
            fatal=(AdbGuardError,),
        )
        # A halt survives a service restart; otherwise systemd would quietly
        # reset the very budget that stopped the loop.
        if halted_file.exists():
            watchdog.halt_now(f"halt marker present: {halted_file}")

    try:
        while not stop.is_set():
            children.tick()
            paused = is_paused(pause_file)
            if game is not None and paused != was_paused:
                if paused:
                    game.stop()
                    log.info("cloud.paused")
                else:
                    if watchdog is not None:
                        watchdog.resume()
                    game.relaunch()
                    warmup_until = time.monotonic() + WARMUP_SECONDS
                    log.info("cloud.unpaused")
                was_paused = paused
            if paused:
                time.sleep(TICK_SECONDS)
                continue
            if watchdog is not None:
                if resume_file.exists():
                    resume_file.unlink(missing_ok=True)
                    halted_file.unlink(missing_ok=True)
                    watchdog.resume()
                    log.info("cloud.resumed")
                state = watchdog.tick()
                if state is not State.RUNNING:
                    warmup_until = time.monotonic() + WARMUP_SECONDS
                if state is State.HALTED:
                    log.error("cloud.halted", marker=str(halted_file))
                elif (
                    device is not None
                    and _flag("DW_CLOUD_ROUTINES")
                    and time.monotonic() >= warmup_until
                    and game_is_up(journal)
                ):
                    run_due(
                        device,
                        schedule,
                        alert=write_alert,
                        unknown_dir=base / "unknown-screens",
                    )
            time.sleep(TICK_SECONDS)
    finally:
        stop.set()
        runner.join(timeout=60)
        children.stop()
        schedule.close()
        journal.close()
        log.info("cloud.stopped")


def game_is_up(journal: Journal) -> bool:
    """Packets arrived in the last few minutes: the client is logged in."""
    seen = last_packet_at(journal)
    return seen is not None and datetime.now(tz=UTC) - seen < timedelta(minutes=5)


def _kill_switch() -> Path | None:
    raw = os.environ.get("DW_UI_KILL_SWITCH_FILE")
    return Path(raw) if raw else None


if __name__ == "__main__":
    main()
