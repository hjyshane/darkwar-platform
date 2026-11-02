"""The sync loop catches up flat out while it can, and backs off when it cannot."""

from __future__ import annotations

from dw_collector.sync.__main__ import CATCH_UP_DELAY, next_delay


def test_a_full_batch_with_nothing_failing_goes_again_at_once() -> None:
    assert next_delay(sent=250, failed=0, batch=250, interval=10.0) == CATCH_UP_DELAY


def test_a_short_batch_means_the_queue_is_empty_so_it_waits() -> None:
    assert next_delay(sent=40, failed=0, batch=250, interval=10.0) == 10.0
    assert next_delay(sent=0, failed=0, batch=250, interval=10.0) == 10.0


def test_any_failure_backs_off_even_after_a_full_batch() -> None:
    assert next_delay(sent=200, failed=50, batch=250, interval=10.0) == 10.0


def test_a_database_that_refuses_everything_is_not_hammered() -> None:
    assert next_delay(sent=0, failed=250, batch=250, interval=10.0) == 10.0
