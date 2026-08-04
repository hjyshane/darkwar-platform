"""A false frame length must not park the stream forever.

dw-capture went silent after a game reconnect and stayed silent — process
up, no error, dw-sync still heartbeating, journal frozen at the login burst
while 18KB kept crossing the wire. The decoder had read a length that never
arrived and was swallowing everything after it as that frame's body.

The cap is what bounds that wait. A length over it is rejected outright; a
length under it is waited for. So the cap is not "reject nonsense", it is
"how long can one bad header hide the stream", and 32MB meant forever.
"""

from __future__ import annotations

import struct

from dw_collector.protocol.frames import MAX_FRAME_SIZE, SmartFoxStreamDecoder
from tests.test_capture_session import envelope, frame

GOOD = envelope("al.rank", {"allianceId": "x", "list": []})


def _long_header(claimed: int) -> bytes:
    """A frame header claiming `claimed` bytes that will never arrive."""
    return bytes([0x88]) + struct.pack("!I", claimed)


def test_the_cap_bounds_how_long_one_bad_header_can_hide_the_stream() -> None:
    """This is the regression, and it is a number rather than a behaviour.

    A false length under the cap is waited for, so the cap decides how much
    traffic must arrive before the decoder can discover it was wrong. At
    32MB that was never, on a link carrying kilobytes a second — which is
    why capture went silent after a reconnect and stayed silent.

    Below: comfortably clear of the largest real frame (83,549 bytes, the
    login response, out of 4,906 across twelve captures), and small enough
    that the wait ends in minutes.
    """
    assert 83_549 * 4 < MAX_FRAME_SIZE <= 4 * 1024 * 1024


def test_a_length_over_the_cap_is_rejected_at_once() -> None:
    decoder = SmartFoxStreamDecoder()

    frames = decoder.feed(_long_header(MAX_FRAME_SIZE + 1) + frame(GOOD))

    assert [f.object for f in frames] == [GOOD]


def test_a_length_under_the_cap_hides_the_stream_until_it_is_reached() -> None:
    """The wedge in miniature, with a small claim so it runs fast.

    Note what this does NOT prove: it feeds the claimed bytes by hand. In
    production those bytes are whatever the game happens to send next, and
    the frame after the bad header stays invisible until that much has
    arrived. The size of that wait is the bug; the recovery below is only
    the half that already worked.
    """
    claimed = 100_000
    decoder = SmartFoxStreamDecoder()

    stalled = decoder.feed(_long_header(claimed) + frame(GOOD))
    assert stalled == [], "the real frame behind the bad header is invisible for now"

    recovered = decoder.feed(b"\x00" * claimed)

    assert [f.object for f in recovered] == [GOOD], "the real frame must survive the resync"
    assert decoder.resync_bytes > 0


def test_a_real_frame_at_the_observed_maximum_still_decodes() -> None:
    # Guards the other direction: tightening the cap must not start
    # rejecting the login response, which is the biggest thing the game
    # sends and the one carrying the hero catalogue.
    # Spread over many fields because an SFS string is length-prefixed with
    # 16 bits; the real login response is large for the same reason, being
    # 27 heroes rather than one enormous value.
    big = envelope("init", {f"hero{i:03d}": "x" * 2_000 for i in range(50)})
    decoder = SmartFoxStreamDecoder()

    frames = decoder.feed(frame(big))

    assert len(frames) == 1
    assert frames[0].encoded_length > 83_549
