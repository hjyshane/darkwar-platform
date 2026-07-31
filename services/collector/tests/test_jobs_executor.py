"""The executor is where a database row turns into taps, so these tests are
mostly about what it refuses to turn into taps.

`payload.routine` arrives from the cloud. It names a routine; it must not be
able to name a *path*.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dw_collector.jobs.executor import RoutineExecutor
from dw_collector.jobs.worker import Job
from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.guard import AdbPolicy

COLLECTOR = "127.0.0.1:5575"
MAIN_ACCOUNT = "127.0.0.1:5565"


@pytest.fixture
def journal(tmp_path: Path) -> Journal:
    j = Journal(tmp_path / "j.db")
    j.init_db()
    return j


@pytest.fixture
def routines(tmp_path: Path) -> Path:
    d = tmp_path / "routines"
    d.mkdir()
    (d / "alliance-daily.json").write_text(
        json.dumps(
            {
                "name": "alliance-daily",
                "steps": [{"name": "roster", "action": "tap", "x": 10, "y": 20}],
            }
        ),
        encoding="utf-8",
    )
    return d


@pytest.fixture
def policy(tmp_path: Path) -> AdbPolicy:
    return AdbPolicy(
        collector_serial=COLLECTOR,
        denylist=frozenset({MAIN_ACCOUNT}),
        kill_switch_file=tmp_path / "STOP",
    )


def _executor(routines: Path, journal: Journal, policy: AdbPolicy) -> RoutineExecutor:
    return RoutineExecutor(routines_dir=routines, journal=journal, policy=policy)


def _job(job_type: str = "run_routine", **payload: object) -> Job:
    return Job(job_id="j1", job_type=job_type, payload=dict(payload), attempt_count=0)


@pytest.mark.parametrize(
    "name",
    [
        "../../../etc/passwd",
        "/etc/passwd",
        "..",
        "sub/dir",
        "sub\\dir",
        "alliance daily",
        "",
        "x" * 200,
    ],
)
def test_a_routine_name_cannot_be_a_path(
    name: str, routines: Path, journal: Journal, policy: AdbPolicy
) -> None:
    outcome = _executor(routines, journal, policy)(_job(routine=name))

    assert not outcome.ok
    assert outcome.permanent
    # Never got as far as loading anything.
    assert "routine" in str(outcome.error)


@pytest.mark.parametrize("value", [None, 42, ["alliance-daily"], {"name": "x"}])
def test_a_routine_name_must_be_a_string(
    value: object, routines: Path, journal: Journal, policy: AdbPolicy
) -> None:
    outcome = _executor(routines, journal, policy)(_job(routine=value))
    assert not outcome.ok
    assert outcome.permanent


def test_a_missing_routine_is_permanent_not_retried(
    routines: Path, journal: Journal, policy: AdbPolicy
) -> None:
    outcome = _executor(routines, journal, policy)(_job(routine="no-such-routine"))

    assert not outcome.ok
    assert outcome.permanent
    assert "no routine named" in str(outcome.error)


def test_a_symlink_out_of_the_directory_is_refused(
    tmp_path: Path, routines: Path, journal: Journal, policy: AdbPolicy
) -> None:
    """The name pattern already bars separators; this is the second check,
    for a link planted inside the directory itself."""
    outside = tmp_path / "elsewhere.json"
    outside.write_text(json.dumps({"name": "x", "steps": []}), encoding="utf-8")
    (routines / "sneaky.json").symlink_to(outside)

    outcome = _executor(routines, journal, policy)(_job(routine="sneaky"))

    assert not outcome.ok
    assert outcome.permanent
    assert "outside" in str(outcome.error)


def test_an_unknown_job_type_is_permanent(
    routines: Path, journal: Journal, policy: AdbPolicy
) -> None:
    outcome = _executor(routines, journal, policy)(_job("delete_everything"))

    assert not outcome.ok
    assert outcome.permanent
    assert "unknown job_type" in str(outcome.error)


def test_the_kill_switch_pauses_rather_than_dead_letters(
    routines: Path, journal: Journal, policy: AdbPolicy
) -> None:
    """FR-OPS-006. Flipping the switch must not require requeuing the whole
    backlog by hand afterwards, so this failure is retryable."""
    assert policy.kill_switch_file is not None
    policy.kill_switch_file.write_text("stop")

    outcome = _executor(routines, journal, policy)(_job(routine="alliance-daily"))

    assert not outcome.ok
    assert not outcome.permanent
    assert "kill switch" in str(outcome.error)


def test_a_misconfigured_guard_is_permanent(
    routines: Path, journal: Journal, tmp_path: Path
) -> None:
    """An empty denylist is a configuration mistake; retrying every 30
    seconds until dead-letter would just repeat the same refusal."""
    unconfigured = AdbPolicy(
        collector_serial=COLLECTOR, denylist=frozenset(), kill_switch_file=tmp_path / "STOP"
    )
    outcome = _executor(routines, journal, unconfigured)(_job(routine="alliance-daily"))

    assert not outcome.ok
    assert outcome.permanent
    assert "guard refused" in str(outcome.error)


def test_a_valid_name_resolves_inside_the_directory(
    routines: Path, journal: Journal, policy: AdbPolicy
) -> None:
    path = _executor(routines, journal, policy).resolve_routine("alliance-daily")
    assert path == (routines / "alliance-daily.json").resolve()
