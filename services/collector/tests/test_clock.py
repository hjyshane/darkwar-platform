"""The server's clock, read from a field whose name lies about it."""

from __future__ import annotations

from datetime import UTC, datetime

from dw_collector.clock import server_time, skew_seconds

# Verbatim from the 2026-07-30 walkthrough capture.
REAL = {"db_utc_timestamp": 0, "db_timezone_offset": 1785436421}


def test_reads_the_epoch_out_of_the_offset_field() -> None:
    assert server_time(REAL) == datetime(2026, 7, 30, 18, 33, 41, tzinfo=UTC)


def test_the_field_named_for_the_timestamp_is_empty() -> None:
    """Pinning the inversion so a future reader does not 'fix' it back."""
    assert REAL["db_utc_timestamp"] == 0


def test_a_real_timezone_offset_is_rejected() -> None:
    """If the server ever starts using the field as its name claims, that
    must read as unusable rather than as a timestamp in 1970."""
    assert server_time({"db_timezone_offset": 32400}) is None
    assert server_time({"db_timezone_offset": -18000}) is None


def test_missing_or_wrong_type_is_none() -> None:
    assert server_time({}) is None
    assert server_time({"db_timezone_offset": "1785436421"}) is None
    assert server_time({"db_timezone_offset": None}) is None


def test_skew_is_signed_server_minus_local() -> None:
    observed = datetime(2026, 7, 30, 18, 33, 11, tzinfo=UTC)  # 30s behind
    assert skew_seconds(REAL, observed) == 30.0

    ahead = datetime(2026, 7, 30, 18, 33, 51, tzinfo=UTC)  # 10s ahead
    assert skew_seconds(REAL, ahead) == -10.0


def test_skew_is_none_when_the_clock_cannot_be_read() -> None:
    assert skew_seconds({}, datetime.now(tz=UTC)) is None
