"""Tests for the adapter list the settings screen shows instead of a blank
text box asking a player to type `\\Device\\NPF_{GUID}` by hand.

The fixture below is real output from `dumpcap -D` on this repo's own dev
machine, GUIDs replaced with obviously fake ones. The adapter names are
Korean — that is not a decoration, it is the exact incident `check_interface`
in `capture/live.py` documents: a wrong interface name capture silently for
days while the task looked healthy. Getting the encoding wrong here would
turn those names into mojibake in a dropdown, which is worse than the text
box it replaces because a player cannot tell which adapter is which.
"""

from __future__ import annotations

from pathlib import Path

from dw_collector.desktop import adapters

# Verbatim shape of `& 'C:\Program Files\Wireshark\dumpcap.exe' -D` on the
# machine this repo ships from (register-tasks.ps1 line 16), with every GUID
# replaced by an obviously fake one. Line 9's nested parentheses
# (`vEthernet (WSL (Hyper-V firewall))`) are real and load-bearing: a naive
# "split on the first `(`" parser gets that line wrong.
FIXTURE = (
    "1. \\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000001} (\ub85c\uceec \uc601\uc5ed "
    "\uc5f0\uacb0* 10)\n"
    "7. \\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000002} (Wi-Fi)\n"
    "8. \\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000003} (\uc774\ub354\ub137)\n"
    "9. \\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000004} "
    "(vEthernet (WSL (Hyper-V firewall)))\n"
    "10. \\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000005} (Tailscale)\n"
    "11. \\Device\\NPF_Loopback (Adapter for loopback traffic capture)\n"
    "13. \\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000006} "
    "(OpenVPN Data Channel Offload for NordVPN)\n"
)

# The Korean adapter name for "Ethernet". Written as a literal, not an
# escape, so a future editor cannot silently corrupt the very thing this
# regression test exists to catch.
KOREAN_ETHERNET_LABEL = "이더넷"


def test_parse_interfaces_on_the_real_fixture() -> None:
    result = adapters.parse_interfaces(FIXTURE)
    assert (
        "\\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000002}",
        "Wi-Fi",
    ) in result
    assert (
        "\\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000003}",
        KOREAN_ETHERNET_LABEL,
    ) in result
    assert ("\\Device\\NPF_Loopback", "Adapter for loopback traffic capture") in result


def test_a_korean_label_round_trips_exactly() -> None:
    """THE REGRESSION THAT MATTERS MOST.

    `capture/live.py::check_interface` records a real incident: an adapter
    named 이더넷 on this machine, a session that captured zero observations
    for days, and a heartbeat that kept saying everything was fine because,
    from scapy's point of view, it was. That incident was about a name
    mismatch, not encoding — but the settings screen this module feeds is
    the first place a Korean adapter name has to survive a decode at all.
    Mangling it here would make a *different* wrong-adapter mistake just as
    easy to make, for the same reason: the player cannot tell two adapters
    apart if their names come through as mojibake.
    """
    result = adapters.parse_interfaces(FIXTURE)
    labels = [label for _, label in result]
    assert KOREAN_ETHERNET_LABEL in labels


def test_the_nested_parentheses_line_parses_in_full() -> None:
    # A greedy "first `(` to last `)`" scan would also get this right by
    # accident on a single line; a naive "first `(` to first `)`" one would
    # truncate to "vEthernet (WSL", which is why this is asserted on its own
    # rather than folded into the fixture-wide test above.
    result = adapters.parse_interfaces(FIXTURE)
    device = "\\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000004}"
    matches = [label for dev, label in result if dev == device]
    assert matches == ["vEthernet (WSL (Hyper-V firewall))"]


def test_a_line_dumpcap_never_promised_to_keep_stable_is_skipped_not_raised() -> None:
    # dumpcap's output format is not a contract. A banner line, a blank
    # line, or a future field dumpcap adds must not take the settings
    # screen down — they just do not become an adapter.
    raw = (
        "Capturing on the following interfaces:\n"
        "\n"
        + FIXTURE
        + "99. \\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000099} (unterminated label\n"
    )
    result = adapters.parse_interfaces(raw)
    devices = [device for device, _ in result]
    assert "\\Device\\NPF_{AAAAAAAA-0000-0000-0000-000000000099}" not in devices
    assert "\\Device\\NPF_Loopback" in devices


def test_empty_output_is_an_empty_list_not_an_error() -> None:
    # No adapters is what "no adapters" looks like — not an exception the
    # settings screen has to catch.
    assert adapters.parse_interfaces("") == []


def test_find_dumpcap_returns_the_first_candidate_that_exists() -> None:
    seen: list[Path] = []

    def fake_exists(path: Path) -> bool:
        seen.append(path)
        return str(path) == adapters.DUMPCAP_CANDIDATES[1]

    found = adapters.find_dumpcap(exists=fake_exists, which=lambda _name: None)
    assert found == adapters.DUMPCAP_CANDIDATES[1]
    # The first candidate was tried (and rejected) before the second — the
    # hardcoded install path this repo has always used comes first.
    assert str(seen[0]) == adapters.DUMPCAP_CANDIDATES[0]


def test_find_dumpcap_is_none_when_nothing_exists_and_path_has_nothing() -> None:
    found = adapters.find_dumpcap(exists=lambda _path: False, which=lambda _name: None)
    assert found is None


def test_find_dumpcap_falls_back_to_path() -> None:
    calls: list[str] = []

    def fake_which(name: str) -> str | None:
        calls.append(name)
        return "C:/tools/dumpcap.exe"

    found = adapters.find_dumpcap(exists=lambda _path: False, which=fake_which)
    assert found == "C:/tools/dumpcap.exe"
    assert calls == ["dumpcap"]


def test_npcap_state_with_no_executable() -> None:
    assert adapters.npcap_state(None, []) == "no-dumpcap"


def test_npcap_state_with_an_executable_but_no_adapters() -> None:
    assert adapters.npcap_state("C:/Program Files/Wireshark/dumpcap.exe", []) == "no-adapters"


def test_npcap_state_ready() -> None:
    found = [("\\Device\\NPF_Loopback", "Adapter for loopback traffic capture")]
    assert adapters.npcap_state("C:/Program Files/Wireshark/dumpcap.exe", found) == "ready"


class _FakeCompletedProcess:
    def __init__(self, stdout: bytes) -> None:
        self.stdout = stdout


def test_list_interfaces_does_not_need_npcap_to_be_tested() -> None:
    """`run` is injected — this proves the parsing/decoding path without
    Npcap, dumpcap, or a real subprocess anywhere near the test."""
    calls: list[list[str]] = []

    def fake_run(args: list[str], **_kwargs: object) -> _FakeCompletedProcess:
        calls.append(args)
        return _FakeCompletedProcess(FIXTURE.encode("utf-8"))

    result = adapters.list_interfaces("C:\\Program Files\\Wireshark\\dumpcap.exe", run=fake_run)
    assert calls == [["C:\\Program Files\\Wireshark\\dumpcap.exe", "-D"]]
    assert ("\\Device\\NPF_Loopback", "Adapter for loopback traffic capture") in result
    labels = [label for _, label in result]
    assert KOREAN_ETHERNET_LABEL in labels
