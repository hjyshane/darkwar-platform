from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import al_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("al.rank") is al_rank.normalize


def test_normal_roster() -> None:
    observation = load_observation("al.rank/synthetic_roster_v1.json")
    rows = al_rank.normalize(observation)

    assert len(rows) == 20
    assert {r.target_table for r in rows} == {"alliance_member_snapshots"}
    assert len({r.idempotency_key for r in rows}) == 20

    first = rows[0].row
    assert first["game_uid"] == 58000001
    assert first["name"] == "SyntheticPlayer01"
    assert first["member_rank"] == 5
    assert first["power"] == 200_000_000
    assert first["server_id"] == 580
    assert first["collected_from_server_id"] == 580
    assert first["parser_version"] == al_rank.PARSER_VERSION
    # Unrecognized fields land in raw with no migration (schema convention).
    assert first["raw"]["decoration_id"] == 9001

    refs = rows[0].entity_refs
    assert refs["alliance"] == {
        "server_id": 580,
        "external_id": 987001,
        "name": "Synthetic CBFW",
        "code": "CBFW",
    }
    assert refs["player"]["game_uid"] == 58000001


def test_null_and_missing_optionals() -> None:
    observation = load_observation("al.rank/synthetic_roster_nulls_v1.json")
    rows = al_rank.normalize(observation)

    assert len(rows) == 3
    bare = rows[0].row
    assert bare["game_uid"] == 58000101
    assert bare["name"] is None
    assert bare["power"] is None
    assert bare["presence_redacted"] is False
    assert rows[2].row["presence_redacted"] is True
    # Alliance with no name: refs still carry the natural key.
    assert rows[0].entity_refs["alliance"]["external_id"] == 987002
    assert rows[0].entity_refs["alliance"]["name"] is None


def test_malformed_payload_rejected() -> None:
    observation = load_observation("al.rank/synthetic_roster_malformed_v1.json")
    with pytest.raises(ValidationError):
        al_rank.normalize(observation)
