"""Resolving which emulator automation may drive.

This is the module that keeps a swipe off the main account, so the tests are
about REFUSALS. Every one of them describes a way the old configuration
failed, or a way a resolver could fail open.
"""

from __future__ import annotations

import pytest

from dw_collector.ui_worker import instances
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy

COLLECTOR = instances.Instance(title="collector", pid=1, endpoint="127.0.0.1:5585")
MAIN = instances.Instance(title="wonderedoffduck", pid=2, endpoint="127.0.0.1:5556")
OTHER = instances.Instance(title="lostidas", pid=3, endpoint="127.0.0.1:5566")


def test_the_collector_is_found_and_everything_else_is_denied() -> None:
    serial, denied = instances.collector_and_others([COLLECTOR, MAIN, OTHER])

    assert serial == "127.0.0.1:5585"
    assert denied == frozenset({"127.0.0.1:5556", "127.0.0.1:5566"})


def test_a_new_instance_is_denied_the_moment_it_runs() -> None:
    """The denylist cannot go stale because it is not written down. A file
    listing four serials protected nothing once the ports moved."""
    _, denied = instances.collector_and_others([COLLECTOR, MAIN])
    _, after = instances.collector_and_others([COLLECTOR, MAIN, OTHER])

    assert OTHER.endpoint not in denied
    assert OTHER.endpoint in after


def test_two_windows_with_the_collector_name_resolve_to_nothing() -> None:
    """AMBIGUITY IS A REFUSAL. Picking one would be the legacy behaviour this
    module exists to replace — `devices[0]` is how automation ends up driving
    the main account."""
    twin = instances.Instance(title="collector", pid=9, endpoint="127.0.0.1:5599")

    serial, denied = instances.collector_and_others([COLLECTOR, twin, MAIN])

    assert serial is None
    assert MAIN.endpoint in denied


def test_no_collector_running_resolves_to_nothing() -> None:
    serial, _ = instances.collector_and_others([MAIN, OTHER])

    assert serial is None


def test_the_title_match_ignores_case_and_padding() -> None:
    # BlueStacks pads titles and the operator types what they see.
    padded = instances.Instance(title="  Collector  ", pid=4, endpoint="127.0.0.1:5575")

    serial, _ = instances.collector_and_others([padded, MAIN])

    assert serial == "127.0.0.1:5575"


def test_a_policy_that_resolved_nothing_refuses() -> None:
    # The failure that matters: resolution broke, and automation must stop
    # rather than fall back to anything.
    policy = AdbPolicy(collector_serial=None, denylist=frozenset(), enumerated=True)

    with pytest.raises(AdbGuardError, match="refuses to pick a device"):
        policy.check_target("127.0.0.1:5585")


def test_a_denied_serial_is_refused_even_when_named() -> None:
    policy = AdbPolicy(
        collector_serial=COLLECTOR.endpoint,
        denylist=frozenset({MAIN.endpoint}),
        enumerated=True,
    )

    with pytest.raises(AdbGuardError, match="denylisted"):
        policy.check_target(MAIN.endpoint)


def test_automation_still_has_to_name_its_target() -> None:
    policy = AdbPolicy(
        collector_serial=COLLECTOR.endpoint,
        denylist=frozenset({MAIN.endpoint}),
        enumerated=True,
    )

    with pytest.raises(AdbGuardError, match="must name its target"):
        policy.check_target(None)


def test_an_empty_denylist_from_a_file_is_still_refused() -> None:
    """The two meanings of empty, kept apart.

    From a file it means nobody listed the main account — FR-COL-010, refuse.
    """
    policy = AdbPolicy(collector_serial=COLLECTOR.endpoint, denylist=frozenset())

    with pytest.raises(AdbGuardError, match="DENYLIST_SERIALS is empty"):
        policy.check_target(COLLECTOR.endpoint)


def test_an_empty_denylist_from_an_enumeration_is_allowed() -> None:
    """...but from an enumeration it means the machine was examined and the
    collector is the only emulator running, which is a finding and a safe
    one."""
    policy = AdbPolicy(collector_serial=COLLECTOR.endpoint, denylist=frozenset(), enumerated=True)

    assert policy.check_target(COLLECTOR.endpoint) == COLLECTOR.endpoint


def test_the_old_configuration_notation_is_recognisable() -> None:
    # `emulator-5584` and `127.0.0.1:5585` are both valid adb serials, so
    # nothing errored when the config used one and the machine used the
    # other. The denylist simply never matched.
    assert instances.looks_like_a_port("127.0.0.1:5585")
    assert not instances.looks_like_a_port("emulator-5584")
