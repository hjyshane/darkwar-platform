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

Rotation itself used to be a gap: terminate, probe usbmux, spawn the next
`pcap` (two interpreter start-ups and a lockdown handshake, several seconds)
with nothing listening in between. A login that landed there - the one
screen that carries the roster and rankings - was lost whole, and a person
who opens the game by hand lands there a few percent of the time. So the
next capture now starts WHILE the old one still runs, and the old one is
ended only once the new file has received a packet. Whether pcapd serves
two sessions at once has not been observed on a real phone; if the second
one dies or stays silent while the first is alive, the supervisor logs it
and goes back to sequential rotation for the rest of the run.

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

#: A chunk is written under this extra suffix and renamed to `.pcap` once the
#: capture process has ended. `ingest-dir` reads any `*.pcap` that has not been
#: touched for a few seconds and then marks it done BY NAME, and a live
#: pymobiledevice3 capture does go quiet for longer than that between buffered
#: writes - so a file with the real name is read half-written and its remaining
#: packets are never read (seen on 2026-10-08: read 2.5 minutes into a
#: 5-minute chunk, the delete failing because the capture still had it open).
PART_SUFFIX = ".part"

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
    #: At rotation, how long the old capture may stay up waiting for the new
    #: one to receive its first packet. 0 restores the sequential rotation
    #: (terminate, then start) and its gap.
    overlap_seconds: float = 10.0


@dataclass(frozen=True)
class ChunkResult:
    outcome: Outcome
    path: Path
    size: int
    detail: str = ""


@dataclass(frozen=True)
class _Handoff:
    """A rotated chunk whose capture is still running until its successor is."""

    proc: CaptureProcess
    result: ChunkResult
    rotated_at: float


def chunk_path(directory: Path, now: datetime, tag: str = "") -> Path:
    """`iphone_<UTC time>[-<tag>].pcap`; the tag keeps two phones apart.

    Two phones that rotate in the same second would otherwise write the same
    name, and `ingest-dir` records a capture by NAME.
    """
    suffix = f"-{tag}" if tag else ""
    return directory / f"iphone_{now.astimezone(UTC):%Y%m%d-%H%M%S}{suffix}.pcap"


def part_path(final: Path) -> Path:
    return final.with_name(final.name + PART_SUFFIX)


def recover_parts(directory: Path) -> int:
    """Promote chunks a previous run left unfinished; return how many.

    A killed parent leaves its `.part` files behind. Their last packet may be
    cut off, which the classic-pcap reader tolerates, and left alone they
    would hold up to five minutes of capture - session signatures included -
    that nothing ever reads. Call this before any capture has started.
    """
    promoted = 0
    for part in directory.glob(f"*{PART_SUFFIX}"):
        final = part.with_name(part.name.removesuffix(PART_SUFFIX))
        if _size(part) > EMPTY_PCAP_BYTES:
            part.replace(final)
            promoted += 1
        else:
            part.unlink(missing_ok=True)
    return promoted


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
        self._overlap_ok = config.overlap_seconds > 0
        self._handoff: _Handoff | None = None

    @property
    def overlap_enabled(self) -> bool:
        """False once a handoff showed the phone will not serve two captures."""
        return self._overlap_ok

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

    def _await_live(
        self, proc: CaptureProcess, out: Path, should_stop: Callable[[], bool]
    ) -> Literal["live", "died", "silent", "stopped"]:
        """Wait for a new capture's first packet while its predecessor runs."""
        deadline = self._clock() + self._config.overlap_seconds
        while True:
            if proc.poll() is not None:
                return "died"
            if _size(out) > EMPTY_PCAP_BYTES:
                return "live"
            if should_stop():
                return "stopped"
            if self._clock() >= deadline:
                return "silent"
            self._sleep(self._config.poll_seconds)

    def _take_over(
        self, proc: CaptureProcess, out: Path, should_stop: Callable[[], bool]
    ) -> Literal["live", "died", "silent", "stopped"]:
        """End the previous chunk's capture once this one is receiving.

        A successor that dies or stays silent while its predecessor is alive is
        read as "this phone serves one capture at a time": overlap is turned
        off for the rest of the run and rotation goes back to terminate-then-
        start. Either way the predecessor is ended and published here.
        """
        handoff = self._handoff
        if handoff is None:
            return "live"
        state = self._await_live(proc, out, should_stop)
        if state in ("died", "silent"):
            self._overlap_ok = False
            self._log.warning(
                "iphone.overlap_unsupported",
                successor=state,
                detail="rotating sequentially from now on",
            )
        self._flush_handoff()
        return state

    def _flush_handoff(self) -> None:
        """Terminate and publish the chunk a rotation left running, if any."""
        handoff = self._handoff
        if handoff is None:
            return
        self._handoff = None
        if handoff.proc.poll() is None:
            handoff.proc.terminate()
        kept = self._keep_or_drop(handoff.result)
        self._log_chunk(handoff.result, kept, overlap=self._clock() - handoff.rotated_at)

    def _log_chunk(self, result: ChunkResult, kept: bool, *, overlap: float | None = None) -> None:
        self._log.info(
            "iphone.chunk",
            outcome=result.outcome,
            bytes=result.size,
            kept=kept,
            file=result.path.name,
            detail=result.detail[-200:],
            overlap_seconds=None if overlap is None else round(overlap, 1),
        )

    def run_chunk(self, should_stop: Callable[[], bool]) -> ChunkResult:
        """Capture one chunk and report how it ended. Always cleans up.

        A chunk that rotates while overlap is on returns with its capture
        still running, held in `self._handoff`; the next call (or `run`) ends
        it. Every other outcome ends the capture before returning.
        """
        cfg = self._config
        final = chunk_path(cfg.directory, self._now(), self._tag)
        out = part_path(final)
        proc = self._backend.start(out)
        started = last_growth = self._clock()
        seen = 0
        handed_off = False
        try:
            state = self._take_over(proc, out, should_stop)
            if state == "died":
                return ChunkResult("died", final, _size(out), proc.stderr_tail())
            if state == "stopped":
                return ChunkResult("stopped", final, _size(out))
            self._maybe_launch()
            while True:
                if should_stop():
                    return ChunkResult("stopped", final, _size(out))
                code = proc.poll()
                if code is not None:
                    return ChunkResult("died", final, _size(out), proc.stderr_tail())
                size = _size(out)
                now = self._clock()
                if size > seen:
                    seen, last_growth = size, now
                if now - started >= cfg.chunk_seconds:
                    result = ChunkResult("rotated", final, size)
                    if self._overlap_ok:
                        self._handoff = _Handoff(proc, result, now)
                        handed_off = True
                    return result
                if now - last_growth >= cfg.stall_seconds:
                    return ChunkResult("stalled", final, size)
                self._sleep(cfg.poll_seconds)
        finally:
            if not handed_off and proc.poll() is None:
                proc.terminate()

    def _keep_or_drop(self, result: ChunkResult) -> bool:
        """Publish a chunk that holds packets; delete one that does not.

        Called only after the capture process has ended, which is what makes
        the rename safe: Windows will not rename a file another process holds.
        """
        part = part_path(result.path)
        if _size(part) > EMPTY_PCAP_BYTES:
            return self._publish(part, result.path)
        try:
            part.unlink(missing_ok=True)
        except OSError as exc:
            self._log.warning("iphone.chunk.unlink_failed", path=str(part), error=str(exc))
        return False

    def _publish(self, part: Path, final: Path) -> bool:
        for attempt in range(5):
            try:
                part.replace(final)
            except OSError as exc:
                # A virus scanner or the dying child can hold the file for a
                # moment. Keep trying briefly; the next start promotes it.
                self._log.warning("iphone.chunk.rename_retry", attempt=attempt, error=str(exc))
                self._sleep(0.5)
            else:
                return True
        return False

    def run(self, should_stop: Callable[[], bool] = lambda: False) -> None:
        cfg = self._config
        cfg.directory.mkdir(parents=True, exist_ok=True)
        backoff = cfg.backoff_min_seconds
        connected = False
        while not should_stop():
            udids = self._backend.devices()
            if not udids:
                # The phone went away at the rotation itself: nothing for the
                # held capture to hand over to.
                self._flush_handoff()
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
            if self._handoff is not None and self._handoff.result is result:
                # Rotated with the capture still up; the next chunk ends and
                # publishes it. It ran a full chunk, so the phone was there.
                backoff = cfg.backoff_min_seconds
                continue
            kept = self._keep_or_drop(result)
            self._log_chunk(result, kept)
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
        # Stopped between a rotation and its successor's start.
        self._flush_handoff()
