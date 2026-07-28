"""Game week boundary: Monday 02:00 UTC.

Implemented three times (SQL reset_week_start, this module, TypeScript); all
three consume protocol-fixtures/reset-week/vectors.json — change together.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

RESET_HOUR_UTC = 2


def reset_week_start(ts: datetime) -> datetime:
    """Most recent Monday 02:00 UTC at or before ts (boundary inclusive)."""
    if ts.tzinfo is None:
        msg = "reset_week_start requires a timezone-aware datetime"
        raise ValueError(msg)
    shifted = ts.astimezone(UTC) - timedelta(hours=RESET_HOUR_UTC)
    monday = shifted.date() - timedelta(days=shifted.weekday())
    return datetime.combine(monday, time(hour=RESET_HOUR_UTC), tzinfo=UTC)
