"""The game server's own clock, as it reports it.

`push.utc.time` carries the server's wall clock. Its field names are
inverted from what they describe, which is why this module exists rather
than a one-line lookup at the call site:

    {"db_utc_timestamp": 0, "db_timezone_offset": 1785436421}

`db_utc_timestamp` is 0 and `db_timezone_offset` holds epoch SECONDS —
1785436421 is 2026-07-30T18:33:41Z, inside the capture window it came from.
A timezone offset is a few tens of thousands of seconds at most, so the
value cannot be what its name says.

Only ONE such event has been observed (2026-07-30 walkthrough), so this
reads the field but nothing writes a stored timestamp from it. Field
semantics inferred from a single sample are exactly what the promotion
discipline exists to keep out of typed columns; `dw-collector clock-skew`
is here to accumulate the samples that would justify more.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

SOURCE_COMMAND = "push.utc.time"
# Named for a timezone offset, holds an epoch. See module docstring.
EPOCH_SECONDS_FIELD = "db_timezone_offset"

# Sanity window: 2023-11-14 .. 2030-03-03. A real epoch lands inside it; a
# genuine timezone offset (max ~50400) does not, so a server that one day
# starts using the field as named fails this check instead of silently
# producing timestamps in 1970.
_MIN_EPOCH = 1_700_000_000
_MAX_EPOCH = 1_900_000_000


def server_time(payload: dict[str, Any]) -> datetime | None:
    """The server's clock from a push.utc.time payload, or None."""
    value = payload.get(EPOCH_SECONDS_FIELD)
    if not isinstance(value, int) or not _MIN_EPOCH < value < _MAX_EPOCH:
        return None
    return datetime.fromtimestamp(value, tz=UTC)


def skew_seconds(payload: dict[str, Any], observed_at: datetime) -> float | None:
    """server clock minus our clock. Positive means the server is ahead."""
    server = server_time(payload)
    if server is None:
        return None
    return (server - observed_at).total_seconds()
