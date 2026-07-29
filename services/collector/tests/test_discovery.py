"""Discovery inbox: unknown commands become shapes, never values."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from dw_collector import pipeline
from dw_collector.discovery import discovery_row, fingerprint, payload_shape
from dw_collector.models import Observation


def _observation(command: str, payload: dict[str, object]) -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c777"),
        source_command=command,
        captured_at=datetime(2026, 7, 27, 12, tzinfo=UTC),
        collected_from_server_id=580,
        payload=payload,
    )


def test_shape_keeps_structure_and_drops_values() -> None:
    shape = payload_shape(
        {
            "uid": "1327205044000578",
            "power": 1125927821,
            "online": True,
            "blob": b"\x00\xff",
            "list": [{"score": 5, "name": "secret"}],
            "empty": [],
            "missing": None,
        }
    )
    assert shape == {
        "blob": "bytes",
        "empty": [],
        "list": [{"name": "string", "score": "integer"}],
        "missing": "null",
        "online": "boolean",
        "power": "integer",
        "uid": "string",
    }
    flattened = repr(shape)
    for secret in ("1327205044000578", "secret", "1125927821"):
        assert secret not in flattened


def test_fingerprint_tracks_shape_not_content() -> None:
    a = payload_shape({"uid": "111", "score": 1})
    b = payload_shape({"uid": "999999", "score": 42})
    c = payload_shape({"uid": "111", "score": 1, "extra": True})
    assert fingerprint(a) == fingerprint(b)
    assert fingerprint(a) != fingerprint(c)


def test_discovery_row_dedupes_on_natural_key() -> None:
    row = discovery_row(_observation("get.battlepass.info", {"a": 1}))
    assert row.target_table == "schema_observations"
    # schema_observations has no idempotency_key column.
    assert row.conflict_target == "source_command,fingerprint"
    assert "idempotency_key" not in row.row
    assert row.row["source_command"] == "get.battlepass.info"
    assert row.row["sample"] == {"a": "integer"}

    # The same shape seen again produces the same key, so a repeat scan
    # cannot fill the admin inbox with duplicates.
    again = discovery_row(_observation("get.battlepass.info", {"a": 2}))
    assert again.idempotency_key == row.idempotency_key


def test_observe_routes_known_and_unknown_commands() -> None:
    unknown = pipeline.observe(_observation("season.map.scan", {"tiles": []}))
    assert [r.target_table for r in unknown] == ["schema_observations"]

    from tests.conftest import load_observation

    known = pipeline.observe(load_observation("al.rank/cbfw_roster_v1.json"))
    assert {r.target_table for r in known} == {"alliance_member_snapshots"}
