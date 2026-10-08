"""Keep an iPhone's packet capture running across USB drops.

The capture itself is `pymobiledevice3 pcap`, one subprocess writing one file.
Three things about it were measured on 2026-10-08 and shape this module:

* **The USB session drops.** Windows keeps listing the phone as a device while
  usbmux reports nothing, and `pcap` then exits with "Device is not
  connected". It happened three times in one hour. A capture that stops there
  and is not restarted looks exactly like a quiet game.
* **It has no file rotation.** One file grows until the process ends, and
  `ingest-dir` records a file by NAME, so a file that is still growing can
  only be read once it is finished. Hence fixed-length chunks.
* **Its stdout is a hex dump of every packet** (11 MB per minute of play).
  Nothing reads it; it goes to the bin.

Ending a chunk by terminating the process can leave a half-written final
packet. The classic-pcap reader stops at a truncated last record by design
(`protocol/pcapng.py`), so that costs one packet, not the file.

This process only captures. Reading the chunks is `dw-collector ingest-dir
--delete-ingested` and draining to Supabase is `dw-sync`, both of which
already exist and already run as their own processes.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

import structlog

log = structlog.get_logger()

#: A classic pcap with no packets is 24 bytes. Anything at or under that is
#: a chunk that captured nothing and is not worth ingesting.
EMPTY_PCAP_BYTES = 24

Outcome = Literal["rotated", "died", "stalled", "stopped"]


class CaptureProcess(Protocol):
    def poll(self) -> int | None: ...
    def terminate(self) -> None: ...
    def stderr_tail(self) -> str: ...


class Backend(Protocol):
    def devices(self) -> list[str]:
        """UDIDs usbmux currently reports. Empty when the session is down."""
        ...

    def start(self, out: Path) -> CaptureProcess: ...


@dataclass(frozen=True)
class IphoneConfig:
    directory: Path
    chunk_seconds: float = 300.0
    #: A live phone is never silent (8 s of an idle one gave 93 KB), so a file
    #: that stops growing means the capture is wedged, not that nothing is
    #: happening.
    stall_seconds: float = 90.0
    poll_seconds: float = 1.0
    backoff_min_seconds: float = 5.0
    backoff_max_seconds: float = 60.0
    #: Restart the game this often so a phone left plugged in keeps receiving
    #: fresh login bundles (the roster and rankings arrive on login). 0 turns
    #: the periodic restart off; a restart on (re)connect always happens.
    relaunch_seconds: float = 21600.0
    #: The capture must be live BEFORE the game starts: a TCP stream joined
    #: mid-flight cannot be read.
    launch_delay_seconds: float = 5.0


@dataclass(frozen=True)
class ChunkResult:
    outcome: Outcome
    path: Path
    size: int
    detail: str = ""


def chunk_path(directory: Path, now: datetime, tag: str = "") -> Path:
    """`iphone_<UTC time>[-<tag>].pcap`; the tag keeps two phones apart.

    Two phones that rotate in the same second would otherwise write the same
    name, and `ingest-dir` records a capture by NAME.
    """
    suffix = f"-{tag}" if tag else ""
    return directory / f"iphone_{now.astimezone(UTC):%Y%m%d-%H%M%S}{suffix}.pcap"


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


class Supervisor:
    def __init__(
        self,
        config: IphoneConfig,
        backend: Backend,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] = lambda: datetime.now(tz=UTC),
        on_connect: Callable[[str], None] | None = None,
        launch: Callable[[], bool] | None = None,
        tag: str = "",
    ) -> None:
        self._tag = tag
        self._log = log.bind(device=tag) if tag else log
        self._config = config
        self._backend = backend
        self._clock = clock
        self._sleep = sleep
        self._now = now
        self._on_connect = on_connect
        self._launch = launch
        self._launch_due = False
        self._last_launch: float | None = None

    def _maybe_launch(self) -> None:
        """Start the game once the capture is already running.

        A failed launch stays due and is retried with the next chunk; it does
        not end the chunk, because the packets that are flowing are still data.
        """
        if self._launch is None or not self._launch_due:
            return
        self._sleep(self._config.launch_delay_seconds)
        try:
            ok = self._launch()
        except Exception as exc:
            self._log.warning("iphone.launch_failed", error=str(exc))
            return
        if ok:
            self._launch_due = False
            self._last_launch = self._clock()
            self._log.info("iphone.launched")
        else:
            self._log.warning("iphone.launch_failed", error="launch command reported failure")

    def _periodic_launch_due(self) -> bool:
        every = self._config.relaunch_seconds
        if self._launch is None or every <= 0 or self._last_launch is None:
            return False
        return self._clock() - self._last_launch >= every

    def run_chunk(self, should_stop: Callable[[], bool]) -> ChunkResult:
        """Capture one chunk and report how it ended. Always cleans up."""
        cfg = self._config
        out = chunk_path(cfg.directory, self._now(), self._tag)
        proc = self._backend.start(out)
        started = last_growth = self._clock()
        seen = 0
        try:
            self._maybe_launch()
            while True:
                if should_stop():
                    return ChunkResult("stopped", out, _size(out))
                code = proc.poll()
                if code is not None:
                    return ChunkResult("died", out, _size(out), proc.stderr_tail())
                size = _size(out)
                now = self._clock()
                if size > seen:
                    seen, last_growth = size, now
                if now - started >= cfg.chunk_seconds:
                    return ChunkResult("rotated", out, size)
                if now - last_growth >= cfg.stall_seconds:
                    return ChunkResult("stalled", out, size)
                self._sleep(cfg.poll_seconds)
        finally:
            if proc.poll() is None:
                proc.terminate()

    def _keep_or_drop(self, result: ChunkResult) -> bool:
        """Delete a chunk that holds no packets; True when one was kept."""
        size = _size(result.path)
        if size > EMPTY_PCAP_BYTES:
            return True
        try:
            result.path.unlink(missing_ok=True)
        except OSError as exc:
            self._log.warning("iphone.chunk.unlink_failed", path=str(result.path), error=str(exc))
        return False

    def run(self, should_stop: Callable[[], bool] = lambda: False) -> None:
        cfg = self._config
        cfg.directory.mkdir(parents=True, exist_ok=True)
        backoff = cfg.backoff_min_seconds
        connected = False
        while not should_stop():
            udids = self._backend.devices()
            if not udids:
                if connected:
                    self._log.warning("iphone.disconnected")
                connected = False
                self._log.info("iphone.waiting", retry_in=backoff)
                self._sleep(backoff)
                backoff = min(backoff * 2, cfg.backoff_max_seconds)
                continue
            if not connected:
                connected = True
                self._log.info("iphone.connected", udid=udids[0])
                self._launch_due = True
                if self._on_connect is not None:
                    self._on_connect(udids[0])
            elif self._periodic_launch_due():
                self._launch_due = True
            result = self.run_chunk(should_stop)
            kept = self._keep_or_drop(result)
            self._log.info(
                "iphone.chunk",
                outcome=result.outcome,
                bytes=result.size,
                kept=kept,
                file=result.path.name,
                detail=result.detail[-200:],
            )
            if result.outcome == "stopped":
                return
            if kept:
                # It captured packets, so the phone WAS there: whatever long
                # wait came before is over. Without this a drop right after a
                # slow reconnect (seen when plugging in) waited a full minute.
                backoff = cfg.backoff_min_seconds
            if result.outcome == "rotated" and kept:
                continue
            # died, stalled, or a rotated chunk with nothing in it: the
            # session is not healthy. Back off before asking usbmux again.
            connected = False
            self._sleep(backoff)
            backoff = min(backoff * 2, cfg.backoff_max_seconds)
