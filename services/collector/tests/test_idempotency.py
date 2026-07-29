"""Regression pin: idempotency keys hash the RAW decoded payload.

If a parser version bump (or any normalizer output change) ever changes the
keys, every replay would duplicate all history (bootstrap plan risk #7).
"""

from __future__ import annotations

import pytest

from dw_collector.models import idempotency_key, payload_hash
from dw_collector.normalize import al_rank
from tests.conftest import load_observation


def test_keys_survive_parser_version_bump(monkeypatch: pytest.MonkeyPatch) -> None:
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    before = [row.idempotency_key for row in al_rank.normalize(observation)]

    monkeypatch.setattr(al_rank, "PARSER_VERSION", "9.9.9-bumped")
    after_rows = al_rank.normalize(observation)
    after = [row.idempotency_key for row in after_rows]

    assert before == after, "idempotency keys must not depend on parser output"
    assert all(r.row["parser_version"] == "9.9.9-bumped" for r in after_rows)


def test_key_changes_with_payload() -> None:
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    mutated = observation.model_copy(update={"payload": {**observation.payload, "extra_field": 1}})
    assert idempotency_key(observation, "s", "b") != idempotency_key(mutated, "s", "b")


def test_payload_hash_is_order_insensitive() -> None:
    assert payload_hash({"a": 1, "b": 2}) == payload_hash({"b": 2, "a": 1})


def test_key_is_deterministic_across_calls() -> None:
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    first = [r.idempotency_key for r in al_rank.normalize(observation)]
    second = [r.idempotency_key for r in al_rank.normalize(observation)]
    assert first == second
