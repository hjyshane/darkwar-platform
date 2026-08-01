"""al.rank normalizer against the REAL payload shape (S14).

cbfw_roster_v1.json is extracted from darkwar_alrank.pcapng by
`dw-collector extract-fixture` (sanitized; see protocol-fixtures/manifests).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import al_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("al.rank") is al_rank.normalize


def test_real_roster() -> None:
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    rows = al_rank.normalize(observation)

    assert len(rows) == 93
    assert {r.target_table for r in rows} == {"alliance_member_snapshots"}
    assert len({r.idempotency_key for r in rows}) == 93

    first = rows[0].row
    assert first["game_uid"] == 9473022442000580
    assert first["name"] == "Member01"
    assert first["member_rank"] == 4
    assert first["hq_level"] == 45
    assert first["power"] == 321950520
    assert first["kills"] == 3276444
    assert first["server_id"] == 580
    assert first["parser_version"] == al_rank.PARSER_VERSION
    assert first["presence_redacted"] is False
    assert first["online_state"] == "online"
    # Unpromoted real fields ride along in raw with no migration.
    assert "alsign" in first["raw"]
    assert "careerType" in first["raw"]

    states = [r.row["online_state"] for r in rows]
    assert states.count("online") == 7
    assert states.count("offline") == 86

    refs = rows[0].entity_refs
    assert refs["alliance"]["external_id"] == observation.payload["allianceId"]
    assert refs["alliance"]["server_id"] == 580
    assert refs["player"]["game_uid"] == 9473022442000580


def test_null_and_missing_optionals() -> None:
    observation = load_observation("al.rank/roster_nulls_v1.json")
    rows = al_rank.normalize(observation)

    assert len(rows) == 3
    bare = rows[0].row
    assert bare["game_uid"] == 9000000101000581
    assert bare["name"] is None
    assert bare["power"] is None
    assert bare["online_state"] is None
    # serverId missing → derived from the uid's embedded server suffix (D-1).
    assert bare["server_id"] == 581
    assert rows[2].row["online_state"] == "offline"
    assert all(r.row["presence_redacted"] is False for r in rows)


def test_redacted_presence_never_reads_as_online() -> None:
    """FR-CORE-003: all-online + offLineTime 0 + pointId 0 is the server
    hiding another alliance's presence, not 100% attendance."""
    observation = load_observation("al.rank/roster_redacted_v1.json")
    rows = al_rank.normalize(observation)

    assert len(rows) == 3
    assert all(r.row["presence_redacted"] is True for r in rows)
    assert all(r.row["online_state"] is None for r in rows)
    # Same reasoning for the timestamp: offLineTime is 0 across a redacted
    # snapshot, and reading that as "went offline at the epoch" would be worse
    # than admitting we were not told.
    assert all(r.row["offline_since"] is None for r in rows)


def test_offline_since_is_the_real_last_online_time() -> None:
    """offLineTime is the one field saying when a member was last playing.
    players.last_seen_at is captured_at — when we looked, not when they were
    there."""
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    rows = al_rank.normalize(observation)

    online = [r.row for r in rows if r.row["online_state"] == "online"]
    offline = [r.row for r in rows if r.row["online_state"] == "offline"]

    # Online is true exactly when offLineTime is 0, so the timestamp is null
    # for precisely the online members — no partial coverage either way.
    assert len(online) == 7
    assert len(offline) == 86
    assert all(r["offline_since"] is None for r in online)
    assert all(r["offline_since"] is not None for r in offline)

    # Milliseconds, not seconds. Pinned against a value read straight out of
    # the payload, so the unit cannot drift; treating it as seconds throws
    # "year 58540 is out of range", which is how the unit was established.
    raw_ms = min(int(m["offLineTime"]) for m in observation.payload["list"] if m.get("offLineTime"))
    oldest = min(r["offline_since"] for r in offline)
    assert oldest == datetime.fromtimestamp(raw_ms / 1000, tz=UTC).isoformat()
    assert oldest.startswith("2026-")


def test_offline_since_survives_a_missing_field() -> None:
    observation = load_observation("al.rank/roster_nulls_v1.json")
    rows = al_rank.normalize(observation)

    # No offLineTime at all, and online unknown.
    assert rows[0].row["offline_since"] is None
    # Present and non-zero → a timestamp, even though this fixture's value is
    # implausibly small. It is what the server said; `raw` keeps the original.
    assert rows[2].row["offline_since"] == datetime.fromtimestamp(86400, tz=UTC).isoformat()


def test_malformed_payload_rejected() -> None:
    observation = load_observation("al.rank/roster_malformed_v1.json")
    with pytest.raises(ValidationError):
        al_rank.normalize(observation)


def test_non_numeric_uid_rejected() -> None:
    observation = load_observation("al.rank/roster_nulls_v1.json")
    broken = observation.model_copy(
        update={
            "payload": {
                **observation.payload,
                "list": [{"uid": "not-a-number"}],
            }
        }
    )
    with pytest.raises(ValidationError):
        al_rank.normalize(broken)
