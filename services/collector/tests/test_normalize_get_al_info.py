"""get.al.info normalizer against the REAL payload shape (S14-PR4)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import get_al_info
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("get.al.info") is get_al_info.normalize


def test_alliance_detail() -> None:
    observation = load_observation("get.al.info/love_580_v1.json")
    rows = get_al_info.normalize(observation)

    assert len(rows) == 1
    row = rows[0].row
    assert rows[0].target_table == "alliance_snapshots"
    assert row["external_id"] == observation.payload["uid"]
    assert row["name"] == "Alliance Detail"
    assert row["code"] == "ADET"
    assert row["power"] == 15289536462
    assert row["member_count"] == 98
    assert row["server_id"] == 580
    # The only confirmed response giving the leader as a UID (alliance.rank
    # gives a display name), so this is where leader_game_uid comes from.
    assert row["leader_game_uid"] == 9734238058000580
    # A detail card has no ranking position.
    assert row["rank"] is None
    # Unpromoted fields survive whole in raw.
    assert row["raw"]["giftLevel"] == 80
    assert row["raw"]["maxMember"] == 100


def test_minimal_payload() -> None:
    rows = get_al_info.normalize(load_observation("get.al.info/detail_nulls_v1.json"))
    row = rows[0].row
    assert row["name"] is None
    assert row["power"] is None
    assert row["leader_game_uid"] is None
    # No createServer → falls back to the observing server.
    assert row["server_id"] == 580


def test_malformed_leader_uid_rejected() -> None:
    with pytest.raises(ValidationError):
        get_al_info.normalize(load_observation("get.al.info/detail_malformed_v1.json"))


def test_keys_deterministic_across_calls() -> None:
    observation = load_observation("get.al.info/love_580_v1.json")
    first = get_al_info.normalize(observation)[0].idempotency_key
    assert first == get_al_info.normalize(observation)[0].idempotency_key
