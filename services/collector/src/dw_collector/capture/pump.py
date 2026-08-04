"""Hand packets to a worker thread so the capture loop never does I/O.

scapy's `sniff(prn=...)` calls back on its own capture loop. The callback
this process used to pass did the whole job there — decode the frame,
normalize it, open a SQLite transaction, commit. While that ran, nothing
was reading from Npcap's ring buffer, and a burst that arrived meanwhile
was dropped by the driver with nothing reported anywhere.

Measured, not guessed: dumpcap and dw-capture over the same window saw 45
command types against 27, and 636 observations against 387. Replaying one
pcapng through both the live session path and the offline path produced
identical output — 638 events, 46 kinds, no difference — so the loss was
never in reassembly or decoding. It was in how long the callback took.

The queue is bounded and the producer BLOCKS when it is full rather than
discarding. Dropping here would trade a loss we can see for one we
cannot, which is the mistake this module exists to undo. A full queue is
counted instead, so "the worker cannot keep up" is a number rather than a
mystery.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable
from types import TracebackType

from dw_collector.protocol.pcapng import TcpSegment

# Roughly a second of the busiest traffic seen so far (1,683 packets in 150s
# with bursts). Large enough to absorb a login burst, small enough that a
# genuinely stuck worker shows up as blocking rather than as memory growth.
DEFAULT_CAPACITY = 20_000


class SegmentPump:
    """A queue between the sniffer and the journal, with one worker."""

    def __init__(
        self,
        handle_segment: Callable[[TcpSegment], None],
        *,
        capacity: int = DEFAULT_CAPACITY,
    ) -> None:
        self._handle = handle_segment
        self._queue: queue.Queue[TcpSegment | None] = queue.Queue(maxsize=capacity)
        self._worker = threading.Thread(target=self._drain, name="dw-capture-pump", daemon=True)
        self._started = False
        # Times the sniffer had to wait for room. Non-zero means the worker is
        # the bottleneck; it does NOT mean anything was lost.
        self.blocked: int = 0
        # Exceptions from the worker are kept rather than swallowed: a journal
        # that stopped accepting writes must not look like a quiet game.
        self.failure: BaseException | None = None

    def start(self) -> None:
        self._started = True
        self._worker.start()

    def submit(self, segment: TcpSegment) -> None:
        """Called on the capture loop. Does no I/O and no parsing."""
        if self.failure is not None:
            raise self.failure
        try:
            self._queue.put_nowait(segment)
        except queue.Full:
            self.blocked += 1
            self._queue.put(segment)

    def _drain(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                return
            try:
                self._handle(item)
            # Broad on purpose: whatever the handler raises is re-raised on
            # the caller's thread, so nothing is swallowed by being caught here.
            except Exception as exc:
                self.failure = exc
                return

    def close(self) -> None:
        """Finish what is queued, then stop. Safe to call more than once."""
        if not self._started:
            return
        self._started = False
        self._queue.put(None)
        self._worker.join(timeout=30.0)
        if self.failure is not None:
            raise self.failure

    @property
    def pending(self) -> int:
        return self._queue.qsize()

    def __enter__(self) -> SegmentPump:
        self.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        # Returns None rather than False so nothing here can be read as
        # suppressing the caller's exception.
        self.close()
