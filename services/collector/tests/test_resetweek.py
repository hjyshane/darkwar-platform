"""Consumes the shared vectors — the same file the SQL and TS tests pin."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from dw_collector.resetweek import reset_week_start
from tests.conftest import FIXTURES

_VECTORS = json.loads((FIXTURES / "reset-week" / "vectors.json").read_text(encoding="utf-8"))[
    "vectors"
]


@pytest.mark.parametrize("vector", _VECTORS, ids=[v["name"] for v in _VECTORS])
def test_shared_vectors(vector: dict[str, str]) -> None:
    result = reset_week_start(datetime.fromisoformat(vector["input"]))
    assert result == datetime.fromisoformat(vector["expected"])


def test_naive_datetime_rejected() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        reset_week_start(datetime(2026, 7, 27, 12, 0))


def test_result_is_utc() -> None:
    result = reset_week_start(datetime(2026, 7, 28, 12, 0, tzinfo=UTC))
    assert result.tzinfo == UTC
    assert result.hour == 2
