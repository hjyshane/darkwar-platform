"""The runner's job is to stop, not to finish.

These tests are mostly about refusing to continue: an unverified step, an
engaged kill switch, a denied serial. The happy path is one test.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from dw_collector.models import Observation
from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.adb import AdbClient
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy
from dw_collector.ui_worker.idle import IdlePolicy
from dw_collector.ui_worker.routine import Routine
from dw_collector.ui_worker.runner import RoutineRunner

COLLECTOR = "127.0.0.1:5575"
MAIN_ACCOUNT = "127.0.0.1:5565"


@pytest.fixture
def policy(tmp_path: Path) -> AdbPolicy:
    return AdbPolicy(
        collector_serial=COLLECTOR,
        denylist=frozenset({MAIN_ACCOUNT}),
        kill_switch_file=tmp_path / "STOP",
    )


@pytest.fixture
def journal(tmp_path: Path) -> Journal:
    j = Journal(tmp_path / "j.db")
    j.init_db()
    return j


def _routine(*steps: dict[str, object]) -> Routine:
    return Routine.model_validate({"name": "test", "steps": list(steps)})


def _record(journal: Journal, command: str, captured_at: datetime | None = None) -> None:
    journal.record(
        Observation(
            observation_id=uuid.uuid4(),
            collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c777"),
            source_command=command,
            captured_at=captured_at or datetime.now(tz=UTC),
            collected_from_server_id=580,
            payload={},
        ),
        [],
    )


class RecordingClient(AdbClient):
    """AdbClient that journals a response when a tap lands, so the runner's
    verification loop has something real to observe."""

    def __init__(
        self,
        *,
        responses: dict[tuple[int, int], str],
        journal: Journal,
        captured_at: datetime | None = None,
        **kw: object,
    ):
        super().__init__(**kw)  # type: ignore[arg-type]
        self.responses = responses
        self.journal = journal
        # Overrides the wire time of every response. A real capture ring
        # writes packets to the journal up to a minute after they were sent,
        # so a stale response can be journalled after a later tap — this is
        # how that is reproduced.
        self.captured_at = captured_at

    def _run(self, argv: list[str], *, capture: bool = False) -> bytes:
        # Overriding the one place every action funnels through, so back and
        # swipe are faked too — an earlier version overrode only tap and the
        # back step went looking for a real adb binary.
        self.policy.check_command(self.serial, argv)
        self.performed.append(argv)
        if argv[:3] == ["shell", "input", "tap"]:
            command = self.responses.get((int(argv[3]), int(argv[4])))
            if command:
                _record(self.journal, command, self.captured_at)
        return b""


def test_verified_run_reports_what_it_saw(policy: AdbPolicy, journal: Journal) -> None:
    client = RecordingClient(
        responses={(10, 20): "al.rank", (30, 40): "alliance.rank"},
        journal=journal,
        policy=policy,
        serial=COLLECTOR,
    )
    routine = _routine(
        {"name": "roster", "action": "tap", "x": 10, "y": 20, "expect": ["al.rank"]},
        {"name": "ranking", "action": "tap", "x": 30, "y": 40, "expect": ["alliance.rank"]},
    )
    report = RoutineRunner(client, journal, sleep=lambda _: None).run(routine)

    assert report.ok
    assert [(s.name, s.status) for s in report.steps] == [("roster", "ok"), ("ranking", "ok")]
    assert report.steps[0].observed == ["al.rank"]


def test_a_moved_layout_stops_the_run_instead_of_tapping_on(
    policy: AdbPolicy, journal: Journal
) -> None:
    """The whole safety argument. Step two lands on nothing, so step three —
    which would tap at unknown coordinates on an unknown screen — never runs."""
    client = RecordingClient(
        responses={(10, 20): "al.rank"},  # (30, 40) now hits empty space
        journal=journal,
        policy=policy,
        serial=COLLECTOR,
    )
    routine = _routine(
        {"name": "roster", "action": "tap", "x": 10, "y": 20, "expect": ["al.rank"]},
        {
            "name": "ranking",
            "action": "tap",
            "x": 30,
            "y": 40,
            "expect": ["alliance.rank"],
            "timeout_seconds": 0.0,
        },
        {"name": "arena", "action": "tap", "x": 50, "y": 60, "expect": ["user.get.arena.info"]},
    )
    report = RoutineRunner(client, journal, sleep=lambda _: None).run(routine)

    assert not report.ok
    assert report.aborted_at == "ranking"
    assert "alliance.rank" in str(report.abort_reason)
    assert [s.name for s in report.steps] == ["roster", "ranking"]
    # The third step's coordinates were never sent.
    assert ["shell", "input", "tap", "50", "60"] not in client.performed


def test_capture_not_running_fails_the_first_step(policy: AdbPolicy, journal: Journal) -> None:
    """No capture means no journal rows, so verification cannot pass. The
    routine must say so rather than walk 19 screens for nothing."""
    client = RecordingClient(responses={}, journal=journal, policy=policy, serial=COLLECTOR)
    routine = _routine(
        {
            "name": "roster",
            "action": "tap",
            "x": 10,
            "y": 20,
            "expect": ["al.rank"],
            "timeout_seconds": 0.0,
        }
    )
    report = RoutineRunner(client, journal, sleep=lambda _: None).run(routine)

    assert not report.ok
    assert report.aborted_at == "roster"
    assert "saw none" in str(report.abort_reason)


def test_kill_switch_stops_mid_routine(policy: AdbPolicy, journal: Journal) -> None:
    """FR-OPS-006: checked before every step, not once at the start."""
    client = RecordingClient(
        responses={(10, 20): "al.rank"}, journal=journal, policy=policy, serial=COLLECTOR
    )
    routine = _routine(
        {"name": "roster", "action": "tap", "x": 10, "y": 20, "expect": ["al.rank"]},
        {"name": "ranking", "action": "tap", "x": 30, "y": 40, "expect": ["alliance.rank"]},
    )

    def engage_after_first(_seconds: float) -> None:
        assert policy.kill_switch_file is not None
        policy.kill_switch_file.write_text("stop")

    report = RoutineRunner(client, journal, sleep=engage_after_first).run(routine)

    assert not report.ok
    assert report.aborted_at == "ranking"
    assert report.abort_reason == "kill switch engaged"
    assert ["shell", "input", "tap", "30", "40"] not in client.performed


class _Idle:
    """Idle until `stop_after` calls, then the operator is back."""

    def __init__(self, stop_after: int | None = None) -> None:
        self.calls = 0
        self.stop_after = stop_after

    def idle_seconds(self) -> float:
        self.calls += 1
        return 5.0 if self.stop_after is not None and self.calls > self.stop_after else 900.0

    def foreground(self) -> tuple[str, str]:
        return "Notepad", "notepad.exe"


def test_operator_returning_stops_the_routine(policy: AdbPolicy, journal: Journal) -> None:
    """FR-COL-009: like the kill switch, re-checked before every step."""
    client = RecordingClient(
        responses={(10, 20): "al.rank"}, journal=journal, policy=policy, serial=COLLECTOR
    )
    routine = _routine(
        {"name": "roster", "action": "tap", "x": 10, "y": 20, "expect": ["al.rank"]},
        {"name": "ranking", "action": "tap", "x": 30, "y": 40, "expect": ["alliance.rank"]},
    )
    idle = IdlePolicy(minimum_idle_seconds=60.0, probe=_Idle(stop_after=1))

    report = RoutineRunner(client, journal, idle=idle, sleep=lambda _: None).run(routine)

    assert not report.ok
    assert report.aborted_at == "ranking"
    assert "operator is active" in str(report.abort_reason)
    assert ["shell", "input", "tap", "30", "40"] not in client.performed


def test_idle_gate_does_not_block_a_quiet_machine(policy: AdbPolicy, journal: Journal) -> None:
    client = RecordingClient(
        responses={(10, 20): "al.rank"}, journal=journal, policy=policy, serial=COLLECTOR
    )
    routine = _routine({"name": "roster", "action": "tap", "x": 10, "y": 20, "expect": ["al.rank"]})
    idle = IdlePolicy(minimum_idle_seconds=60.0, probe=_Idle())

    report = RoutineRunner(client, journal, idle=idle, sleep=lambda _: None).run(routine)

    assert report.ok


def test_dry_run_skips_the_idle_gate(policy: AdbPolicy, journal: Journal) -> None:
    """A dry run taps nothing, so there is no one to interrupt — and an
    unmeasurable platform must not make `--dry-run` unusable off Windows."""
    client = RecordingClient(
        responses={},
        journal=journal,
        policy=policy,
        serial=COLLECTOR,
        dry_run=True,
    )
    routine = _routine({"name": "roster", "action": "tap", "x": 10, "y": 20, "expect": ["al.rank"]})
    idle = IdlePolicy(minimum_idle_seconds=60.0, probe=None)  # would refuse

    report = RoutineRunner(client, journal, idle=idle, sleep=lambda _: None).run(routine)

    assert report.ok


def test_main_account_serial_never_reaches_a_tap(policy: AdbPolicy, journal: Journal) -> None:
    client = RecordingClient(
        responses={(10, 20): "al.rank"}, journal=journal, policy=policy, serial=MAIN_ACCOUNT
    )
    routine = _routine({"name": "roster", "action": "tap", "x": 10, "y": 20})

    # Propagated, not folded into the report: a guard failure is not an
    # operational hiccup to summarise, it is the one thing this must never
    # get wrong.
    with pytest.raises(AdbGuardError, match="denylisted"):
        RoutineRunner(client, journal, sleep=lambda _: None).run(routine)


def test_dry_run_performs_nothing_and_verifies_nothing(
    policy: AdbPolicy, journal: Journal, tmp_path: Path
) -> None:
    client = AdbClient(policy=policy, serial=COLLECTOR, dry_run=True)
    routine = _routine(
        {
            "name": "roster",
            "action": "tap",
            "x": 10,
            "y": 20,
            "expect": ["al.rank"],
            "timeout_seconds": 0.0,
        }
    )
    report = RoutineRunner(client, journal, sleep=lambda _: None).run(routine)

    # Not "ok because it worked" — ok because nothing was attempted.
    assert report.ok
    assert [s.status for s in report.steps] == ["skipped"]
    assert client.performed == [["shell", "input", "tap", "10", "20"]]


def test_back_and_wait_steps_need_no_verification(policy: AdbPolicy, journal: Journal) -> None:
    client = RecordingClient(responses={}, journal=journal, policy=policy, serial=COLLECTOR)
    routine = _routine(
        {"name": "close", "action": "back"},
        {"name": "settle", "action": "wait", "settle_seconds": 0.0},
    )
    report = RoutineRunner(client, journal, sleep=lambda _: None).run(routine)

    assert report.ok
    assert [s.status for s in report.steps] == ["skipped", "skipped"]


def test_a_step_that_expects_a_response_from_back_is_rejected() -> None:
    """Backing out produces no response, so such a step could never pass —
    catching it at load time beats aborting every run at that step."""
    with pytest.raises(ValueError, match="cannot expect a command"):
        _routine({"name": "close", "action": "back", "expect": ["al.rank"]})


def test_tap_without_coordinates_is_rejected() -> None:
    with pytest.raises(ValueError, match="needs x and y"):
        _routine({"name": "roster", "action": "tap"})


def test_routine_loads_from_disk(tmp_path: Path) -> None:
    path = tmp_path / "r.json"
    path.write_text(
        json.dumps(
            {
                "name": "alliance_daily",
                "steps": [{"name": "roster", "action": "tap", "x": 1, "y": 2}],
            }
        ),
        encoding="utf-8",
    )
    assert Routine.load(path).name == "alliance_daily"


def test_commands_after_ignores_earlier_rows(journal: Journal) -> None:
    """The boundary is an insert position, not a moment.

    Written as three statements with no delay between them on purpose: that
    is what a tap and its response look like to a 15.6ms Windows clock, and a
    created_at comparison returns nothing at all for this.
    """
    _record(journal, "before.tap")
    boundary = journal.watermark()
    _record(journal, "after.tap")

    assert journal.commands_after(boundary) == {"after.tap"}


def test_kill_switch_stops_a_run_that_is_waiting(policy, journal):
    """The wait is the long part, so it is the part that has to notice.

    A step with `expect` blocks for up to timeout_seconds. Checking the
    switch only between steps meant engaging it did nothing for as long as
    that wait — 150s in the board sweeps, which is not a stop.
    """
    # Not a dry run: dry runs skip verification entirely, so the wait this
    # test is about would never happen. No responses, so nothing arrives and
    # the runner settles into polling.
    client = RecordingClient(responses={}, journal=journal, policy=policy, serial=COLLECTOR)
    ticks: list[float] = []

    def sleep(seconds: float) -> None:
        ticks.append(seconds)
        # Engaged partway through the wait, by somebody sitting down.
        if len(ticks) == 2:
            policy.kill_switch_file.write_text("stop", encoding="utf-8")

    runner = RoutineRunner(client, journal, sleep=sleep)
    routine = _routine(
        {
            "name": "waits",
            "action": "tap",
            "x": 1,
            "y": 2,
            "expect": ["never.arrives"],
            "timeout_seconds": 600,
            "settle_seconds": 0,
        }
    )

    report = runner.run(routine)

    assert report.ok is False
    assert report.aborted_at == "waits"
    assert report.abort_reason == "kill switch engaged"
    # Stopped in the wait, not after 600 seconds of polling.
    assert len(ticks) < 10


def test_a_late_arriving_older_packet_is_not_proof(policy: AdbPolicy, journal: Journal) -> None:
    """The bug this closes: eight alliances reported verified, two opened.

    The capture ring closes a file every 60s, so a response the game sent
    before the tap reaches the journal after it. A rowid-only test counts
    that as proof, and every step gets credited with the previous step's
    late answer.
    """
    stale = datetime.now(tz=UTC) - timedelta(minutes=5)
    client = RecordingClient(
        responses={(1, 2): "al.rank"},
        journal=journal,
        captured_at=stale,
        policy=policy,
        serial=COLLECTOR,
    )
    runner = RoutineRunner(client, journal, sleep=lambda _s: None)
    routine = _routine(
        {
            "name": "opens a roster",
            "action": "tap",
            "x": 1,
            "y": 2,
            "expect": ["al.rank"],
            "timeout_seconds": 3,
            "settle_seconds": 0,
        }
    )

    report = runner.run(routine)

    # Written after the tap, but sent five minutes before it. Not this tap's.
    assert report.ok is False
    assert report.steps[0].status == "unverified"
    assert report.steps[0].missing == ["al.rank"]
