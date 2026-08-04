"""A capture interface that matches nothing must fail loudly.

Written after a live session where it did the opposite: DW_CAPTURE_INTERFACE
was set to the adapter's Korean friendly name, scapy accepted it without
complaint, and dw-capture ran for minutes journalling nothing. Nothing in
the logs, the process, or the heartbeat said anything was wrong — the
collector was alive, it just never saw a packet.

No scapy needed: the check is a pure function over the names scapy would
accept, which is also why it can run in CI.
"""

from __future__ import annotations

import pytest

from dw_collector.capture.live import InterfaceNotFoundError, check_interface

KNOWN = [
    "이더넷",
    "\\Device\\NPF_{42375586-EBDA-4C7C-A14C-3C32A21FF40A}",
    "Wi-Fi",
]


def test_none_means_let_scapy_choose() -> None:
    # Unset is a legitimate configuration and the one that got capture
    # working again, so it must not be turned into an error.
    check_interface(None, KNOWN)


def test_a_known_friendly_name_passes() -> None:
    check_interface("이더넷", KNOWN)


def test_the_device_form_passes() -> None:
    check_interface("\\Device\\NPF_{42375586-EBDA-4C7C-A14C-3C32A21FF40A}", KNOWN)


def test_an_unknown_name_is_refused_before_any_packet() -> None:
    with pytest.raises(InterfaceNotFoundError) as caught:
        check_interface("Ethernet", KNOWN)

    message = str(caught.value)
    # The two things an operator needs at 2am: what was asked for, and what
    # was actually available.
    assert "'Ethernet'" in message
    assert "이더넷" in message


def test_the_message_points_at_the_form_that_cannot_be_mangled() -> None:
    # A locale-mangled name is the way most people will arrive here, so the
    # suggestion has to be the ASCII one rather than "check your spelling".
    with pytest.raises(InterfaceNotFoundError) as caught:
        check_interface("?????", KNOWN)

    assert "NPF" in str(caught.value)


def test_an_empty_known_list_still_refuses() -> None:
    # Machine with no adapters enumerated is not a reason to proceed: it is
    # the same silent-nothing outcome by another route.
    with pytest.raises(InterfaceNotFoundError):
        check_interface("이더넷", [])
