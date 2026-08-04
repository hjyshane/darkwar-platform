"""The queue between the sniffer and the journal.

It exists because journalling from scapy's callback stalled the capture
loop and Npcap dropped the difference: over one window dumpcap saw 45
command types and 636 observations where dw-capture journalled 27 and
387. Replaying a pcapng through both the session and the offline path
gave identical results, so the decoding was never the problem.
"""

from __future__ import annotations

import threading
import time

import pytest

from dw_collector.capture.pump import SegmentPump
from dw_collector.protocol.pcapng import TcpSegment


def _segment(sequence: int) -> TcpSegment:
    return TcpSegment(
        source_ip="10.0.0.1",
        destination_ip="10.0.0.2",
        source_port=8680,
        destination_port=50000,
        sequence=sequence,
        payload=b"x",
    )


def test_every_submitted_segment_reaches_the_handler() -> None:
    seen: list[int] = []
    with SegmentPump(lambda s: seen.append(s.sequence)) as pump:
        for i in range(500):
            pump.submit(_segment(i))

    assert seen == list(range(500))


def test_order_is_preserved() -> None:
    # Reassembly tolerates reordering, but there is no reason to introduce
    # any here, and a stable order keeps journal writes deterministic.
    seen: list[int] = []
    with SegmentPump(lambda s: seen.append(s.sequence), capacity=8) as pump:
        for i in range(200):
            pump.submit(_segment(i))

    assert seen == sorted(seen)


def test_the_queued_tail_is_written_before_close_returns() -> None:
    # The whole point is that the handler runs behind the producer, so
    # shutdown has to wait for it. Otherwise the fix moves the loss to the
    # end of every run instead of removing it.
    seen: list[int] = []

    def slow(segment: TcpSegment) -> None:
        time.sleep(0.001)
        seen.append(segment.sequence)

    pump = SegmentPump(slow)
    pump.start()
    for i in range(100):
        pump.submit(_segment(i))
    pump.close()

    assert len(seen) == 100


def test_a_full_queue_blocks_rather_than_discards() -> None:
    # Dropping here would trade a loss that can be measured for one that
    # cannot, which is the mistake this module undoes.
    released = threading.Event()
    seen: list[int] = []

    def blocked(segment: TcpSegment) -> None:
        released.wait(timeout=5)
        seen.append(segment.sequence)

    pump = SegmentPump(blocked, capacity=2)
    pump.start()
    producer = threading.Thread(target=lambda: [pump.submit(_segment(i)) for i in range(10)])
    producer.start()
    time.sleep(0.05)
    released.set()
    producer.join(timeout=5)
    pump.close()

    assert len(seen) == 10
    assert pump.blocked > 0


def test_a_failing_handler_surfaces_instead_of_going_quiet() -> None:
    # A journal that stopped accepting writes must not look like a quiet
    # game — that is exactly the failure this session spent hours chasing.
    def explode(segment: TcpSegment) -> None:
        raise RuntimeError("journal is gone")

    pump = SegmentPump(explode)
    pump.start()
    with pytest.raises(RuntimeError, match="journal is gone"):
        for i in range(1000):
            pump.submit(_segment(i))
            time.sleep(0.001)
        pump.close()


def test_close_without_start_is_harmless() -> None:
    SegmentPump(lambda s: None).close()
