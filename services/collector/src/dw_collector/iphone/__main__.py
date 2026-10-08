"""dw-iphone: capture every plugged-in iPhone, read the chunks, upload them.

One process is the whole chain, so one scheduled task or launchd job runs it:

    phone -> pymobiledevice3 pcap (chunks)  -> ingest-dir --delete-ingested
                                            -> dw-sync -> Supabase

The phone data gets its OWN journal. The BlueStacks chain keeps writing
`live.db`; two ingesters on one SQLite file is a risk that buys nothing, and
both reach the same Supabase either way.
"""

from __future__ import annotations

import os
import signal
import sys
import threading
import time
from pathlib import Path

import structlog

from dw_collector.envfile import load_env_file
from dw_collector.iphone.children import ChildGroup, ChildSpec
from dw_collector.iphone.device import PmdBackend, find_tool
from dw_collector.iphone.fleet import Fleet, short_tag
from dw_collector.iphone.supervisor import IphoneConfig, Supervisor, recover_parts

log = structlog.get_logger()

TICK_SECONDS = 5.0


def data_dir() -> Path:
    explicit = os.environ.get("DW_DATA_DIR")
    if explicit:
        return Path(explicit)
    return Path("C:/DW_data") if sys.platform == "win32" else Path.home() / "dw-data"


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def child_specs(capture_dir: Path, journal: Path) -> list[ChildSpec]:
    """The existing commands, pointed at the phone chain's own journal."""
    env = {"DW_SQLITE_PATH": str(journal)}
    server = os.environ.get("DW_COLLECTOR_SERVER_ID", "580")
    ingest = [
        sys.executable,
        "-c",
        "from dw_collector.cli import app; app()",
        "ingest-dir",
        "--dir",
        str(capture_dir),
        "--delete-ingested",
        "--interval-seconds",
        "10",
        "--min-age-seconds",
        "5",
        "--collected-from-server",
        server,
    ]
    return [
        ChildSpec("ingest", ingest, env),
        ChildSpec("sync", [sys.executable, "-m", "dw_collector.sync"], env),
    ]


def main() -> None:
    base = data_dir()
    if not os.environ.get("DW_ENV_FILE") and (base / ".env").is_file():
        os.environ["DW_ENV_FILE"] = str(base / ".env")
    load_env_file()

    capture_dir = Path(os.environ.get("DW_IPHONE_DIR", str(base / "iphone")))
    journal = Path(os.environ.get("DW_IPHONE_DB", str(base / "iphone.db")))
    capture_dir.mkdir(parents=True, exist_ok=True)
    journal.parent.mkdir(parents=True, exist_ok=True)

    config = IphoneConfig(
        directory=capture_dir,
        chunk_seconds=float(os.environ.get("DW_IPHONE_CHUNK_SECONDS", "300")),
        relaunch_seconds=float(os.environ.get("DW_IPHONE_RELAUNCH_HOURS", "6")) * 3600,
    )
    tool = find_tool(os.environ.get("DW_IPHONE_TOOL", "pymobiledevice3"))
    bundle_id = os.environ.get("DW_IPHONE_BUNDLE_ID", "com.readygo.dark.nbios")
    only_udid = os.environ.get("DW_IPHONE_UDID") or None
    userspace = _flag("DW_IPHONE_USERSPACE")
    no_launch = _flag("DW_IPHONE_NO_LAUNCH")

    stop = threading.Event()

    def _stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    def discover() -> list[str]:
        return PmdBackend(tool, udid=only_udid, userspace=userspace).devices()

    def make_supervisor(udid: str) -> Supervisor:
        backend = PmdBackend(tool, udid=udid, userspace=userspace)
        launch = None if no_launch else (lambda: backend.launch(bundle_id))
        return Supervisor(config, backend, launch=launch, tag=short_tag(udid))

    recovered = recover_parts(capture_dir)
    if recovered:
        log.info("iphone.recovered_parts", count=recovered)

    children = None
    if not _flag("DW_IPHONE_CAPTURE_ONLY"):
        children = ChildGroup(child_specs(capture_dir, journal))
        children.start()

    log.info(
        "iphone.start",
        directory=str(capture_dir),
        journal=str(journal),
        chunk_seconds=config.chunk_seconds,
        relaunch_hours=config.relaunch_seconds / 3600,
        only_udid=only_udid,
        chain=children is not None,
    )
    fleet = Fleet(discover, make_supervisor)
    runner = threading.Thread(target=fleet.run, args=(stop.is_set,), name="iphone-fleet")
    runner.daemon = True
    runner.start()
    try:
        while not stop.is_set():
            if children is not None:
                children.tick()
            time.sleep(TICK_SECONDS)
    finally:
        stop.set()
        runner.join(timeout=60)
        if children is not None:
            children.stop()
        log.info("iphone.stopped")


if __name__ == "__main__":
    main()
