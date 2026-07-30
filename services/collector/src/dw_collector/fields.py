"""Decoders for fields that appear across several responses.

Shared so a unit trap is handled once. The monthly pass is the current
example: six confirmed responses carry `monthCardEndTime`, it is in seconds
while `headSkinET` sitting beside it is in milliseconds, and -1 means "no
pass" rather than a date in 1969.
"""

from __future__ import annotations

from datetime import UTC, datetime

# Below this, a value cannot be a plausible expiry: it is a sentinel (-1, 0)
# or a millisecond value that leaked in. 2020-01-01 in epoch seconds.
_MIN_PLAUSIBLE_EPOCH_SECONDS = 1_577_836_800
# Above this it is milliseconds, not seconds. 2100-01-01 in epoch seconds.
_MAX_PLAUSIBLE_EPOCH_SECONDS = 4_102_444_800


def month_card_expires_at(value: object) -> str | None:
    """`monthCardEndTime` → ISO timestamp, or None when there is no pass.

    Returns None for the -1 and 0 sentinels, and for anything outside a
    plausible range rather than inventing a date from a value we do not
    understand.
    """
    if not isinstance(value, int) or isinstance(value, bool):
        return None
    if not _MIN_PLAUSIBLE_EPOCH_SECONDS <= value <= _MAX_PLAUSIBLE_EPOCH_SECONDS:
        return None
    return datetime.fromtimestamp(value, tz=UTC).isoformat()
