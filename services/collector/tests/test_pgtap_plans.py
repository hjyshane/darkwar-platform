"""Structural checks on the pgTAP suite, from a gate that can actually run.

WHY THESE LIVE IN THE PYTHON SUITE. `supabase test db` needs the local stack,
which needs Docker, which is not run on this machine — so a pgTAP file can be
written, committed and merged without ever executing. Anything about those
files that can be checked as TEXT is worth checking here, because it is the
only automated look they get until somebody runs the real suite.

WHAT IS DELIBERATELY NOT HERE: a check that `plan(N)` matches the number of
assertions. It was written, and it failed eighteen files that are known good
— the full suite passed 927 tests over 86 files earlier the same day. This
codebase writes assertions in shapes a regex cannot count (split across
lines, driven off `unnest`, nested inside a larger query), and counting them
properly means parsing SQL. A check that fails correct code is worse than no
check, so it was removed rather than loosened until it stopped complaining.
"""

from __future__ import annotations

from pathlib import Path

import pytest

TESTS = Path(__file__).resolve().parents[3] / "supabase" / "tests"


def _files() -> list[Path]:
    return sorted(TESTS.glob("*.sql"))


def test_there_are_pgtap_files_to_check() -> None:
    # Guards the guard: a wrong TESTS path would make everything below pass
    # by iterating nothing at all.
    assert len(_files()) > 20


@pytest.mark.parametrize("path", _files(), ids=lambda p: p.name)
def test_every_file_is_a_transaction_that_rolls_back(path: Path) -> None:
    """A pgTAP file that commits leaves its fixtures behind, and every file
    after it in the run inherits them — which is how a suite starts passing
    or failing depending on what order it happens to run in."""
    sql = path.read_text(encoding="utf-8").lower()

    assert "begin;" in sql, f"{path.name} does not open a transaction"
    assert "rollback;" in sql, f"{path.name} does not roll back"


@pytest.mark.parametrize("path", _files(), ids=lambda p: p.name)
def test_every_file_declares_and_finishes_a_plan(path: Path) -> None:
    """Without `plan()` pgTAP cannot tell a file that ran every test from one
    that died a third of the way through, and without `finish()` it never
    reports."""
    sql = path.read_text(encoding="utf-8").lower()

    assert "select plan(" in sql, f"{path.name} declares no plan"
    assert "select * from finish();" in sql, f"{path.name} never calls finish()"
