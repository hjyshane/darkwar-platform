"""dw-iphone entrypoint: capture an iPhone's game traffic over USB, forever."""

from __future__ import annotations

import os
import signal
from pathlib import Path

import structlog

from dw_collector.envfile import load_env_file
from dw_collector.iphone.device import PmdBackend, find_tool
from dw_collector.iphone.supervisor import IphoneConfig, Supervisor

log = structlog.get_logger()


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def main() -> None:
    load_env_file()
    config = IphoneConfig(
        directory=Path(os.environ.get("DW_IPHONE_DIR", "./data/iphone")),
        chunk_seconds=float(os.environ.get("DW_IPHONE_CHUNK_SECONDS", "300")),
        relaunch_seconds=float(os.environ.get("DW_IPHONE_RELAUNCH_HOURS", "6")) * 3600,
    )
    bundle_id = os.environ.get("DW_IPHONE_BUNDLE_ID", "com.readygo.dark.nbios")
    backend = PmdBackend(
        find_tool(os.environ.get("DW_IPHONE_TOOL", "pymobiledevice3")),
        udid=os.environ.get("DW_IPHONE_UDID") or None,
        userspace=_flag("DW_IPHONE_USERSPACE"),
    )
    stopping = False

    def _stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    log.info("iphone.start", directory=str(config.directory), chunk_seconds=config.chunk_seconds)
    launch = None if _flag("DW_IPHONE_NO_LAUNCH") else (lambda: backend.launch(bundle_id))
    Supervisor(config, backend, launch=launch).run(lambda: stopping)
    log.info("iphone.stopped")


if __name__ == "__main__":
    main()
