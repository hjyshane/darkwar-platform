"""Searching a capture for one player, without a display.

The whole feature exists because a raw PCAP carries the capturing account's
uid and session signature, so it must never be uploaded — the decode happens
on the machine the file is already on.
"""

from __future__ import annotations

from dw_collector.console import find


def test_a_uid_matches_whole_never_as_a_substring() -> None:
    # THE TRAP: the last six digits of a uid are the player's server, so a
    # substring match on "000581" would pull in every player on 581 — the
    # opposite of narrowing, and it would look like it worked.
    assert find.matches("1190060554000581", None, 1190060554000581) is True
    assert find.matches("000581", None, 1190060554000581) is False
    assert find.matches("119006", None, 1190060554000581) is False


def test_a_name_matches_loosely_and_ignores_case() -> None:
    # Names are the convenience, not the handle: a piece is enough.
    assert find.matches("erha", "ERHA SANGMAIMA", 1) is True
    assert find.matches("SANGMAIMA", "ERHA SANGMAIMA", 1) is True
    assert find.matches("erha", None, 1) is False


def test_an_empty_needle_matches_nothing() -> None:
    # Otherwise pressing Find on an empty box returns the entire capture.
    assert find.matches("", "ERHA", 1) is False
    assert find.matches("   ", "ERHA", 1) is False


def test_the_covered_box_is_reported_so_absence_can_be_read() -> None:
    """NOT FOUND IS TWO ANSWERS and only the box separates them.

    A capture that never passed over the ground cannot say who is standing
    on it. Reporting a bare "not found" reads as "they moved", which is the
    wrong conclusion and the expensive one — it sends somebody hunting for a
    base that never left.
    """
    scan = find.Scan(tiles=94, matches=(), covered=(364, 476, 416, 537))

    assert scan.covers == "x 364..476, y 416..537"
    assert scan.saw(400, 500) is True
    # The real case: ERHA's last position, well outside the ground this
    # capture read.
    assert scan.saw(566, 508) is False


def test_a_capture_with_no_tiles_says_so_rather_than_claiming_a_box() -> None:
    scan = find.Scan(tiles=0, matches=(), covered=None)

    assert scan.covers == "no tiles at all"
    assert scan.saw(500, 500) is False
