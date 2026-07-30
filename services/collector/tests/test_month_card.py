"""Monthly pass expiry — a field with two traps in the real payloads."""

from __future__ import annotations

from datetime import UTC, datetime

from dw_collector.fields import month_card_expires_at
from dw_collector.normalize import al_rank, kill_rank, server_rank
from tests.conftest import load_observation


def test_sentinels_are_not_dates() -> None:
    """31 of 93 roster members carried -1. Converting that naively yields
    December 1969 and reads as a long-expired pass."""
    assert month_card_expires_at(-1) is None
    assert month_card_expires_at(0) is None


def test_milliseconds_are_rejected_not_misread() -> None:
    """headSkinET sits in the same object and IS in milliseconds. A value that
    large is not a plausible expiry, so it is refused rather than turned into
    a date in the year 58000."""
    assert month_card_expires_at(1787623200000) is None
    assert (
        month_card_expires_at(1787623200) == datetime.fromtimestamp(1787623200, tz=UTC).isoformat()
    )


def test_non_integers_and_booleans_are_ignored() -> None:
    assert month_card_expires_at(None) is None
    assert month_card_expires_at("1787623200") is None
    assert month_card_expires_at(True) is None


def test_roster_promotes_the_pass() -> None:
    rows = al_rank.normalize(load_observation("al.rank/cbfw_roster_v1.json"))
    values = [r.row["month_card_expires_at"] for r in rows]
    # The real roster is a mix: some members hold a pass, 31 do not.
    assert sum(1 for v in values if v is None) == 31
    assert sum(1 for v in values if v is not None) == 62
    # Every promoted value is a real future-ish date, never 1969.
    for value in values:
        if value is not None:
            assert datetime.fromisoformat(value).year >= 2026
    # The raw sentinel is still there for anyone who needs it.
    assert -1 in [r.row["raw"].get("monthCardEndTime") for r in rows]


def test_rankings_promote_the_pass_too() -> None:
    """The same field arrives from responses that write player_snapshots, so
    the pass survives even when the roster was not opened."""
    for observation, normalize in (
        (load_observation("server.rank/group_top150_v1.json"), server_rank.normalize),
        (load_observation("kill.rank/group_kills_v1.json"), kill_rank.normalize),
    ):
        rows = normalize(observation)
        promoted = [r.row["month_card_expires_at"] for r in rows]
        assert any(v is not None for v in promoted)
        assert all(v is None or datetime.fromisoformat(v).year >= 2026 for v in promoted)
