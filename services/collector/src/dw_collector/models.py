"""The Observation contract — the collector's upstream seam.

Everything downstream (registry, normalizers, journal, outbox, sync) is
written against `Observation` and tested with fixtures. Live capture is just
one producer of Observations; nothing below capture/ may import scapy or
assume a live socket.
"""

from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


def json_default(value: Any) -> str:
    """SFS type 10 decodes to bytes (army lineups, blobs), which json cannot
    encode. Base64 keeps it representable and, crucially, deterministic —
    idempotency keys hash this output."""
    if isinstance(value, bytes):
        return "b64:" + base64.b64encode(value).decode("ascii")
    msg = f"cannot serialize {type(value).__name__} in a decoded payload"
    raise TypeError(msg)


class Observation(BaseModel):
    """One decoded SmartFox response, before any normalization."""

    model_config = ConfigDict(frozen=True, ser_json_bytes="base64")

    observation_id: uuid.UUID
    collector_id: uuid.UUID
    source_command: str
    captured_at: datetime
    # Where the observation was made — NOT the subject's server. A
    # server.rank response captured from 580 contains players from all eight
    # servers; the subject's server_id lives on each normalized row.
    collected_from_server_id: int
    payload: dict[str, Any]
    schema_version: int = 1

    @field_validator("captured_at")
    @classmethod
    def _require_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            msg = "captured_at must be timezone-aware"
            raise ValueError(msg)
        return value.astimezone(UTC)


class NormalizedRow(BaseModel):
    """One row bound for a Supabase snapshot table.

    `row` holds column values the collector can produce locally. Cloud-side
    UUIDs (alliance_id, player_id) are not among them — the sync worker
    resolves `entity_refs` (natural keys) against Supabase and fills them in.
    """

    model_config = ConfigDict(frozen=True, ser_json_bytes="base64")

    target_table: str
    idempotency_key: str
    row: dict[str, Any]
    entity_refs: dict[str, Any] = Field(default_factory=dict)
    # Which unique constraint the cloud upsert conflicts on. Snapshot tables
    # all carry idempotency_key; discovery rows dedupe on their own natural
    # key instead.
    conflict_target: str = "idempotency_key"


def payload_hash(payload: dict[str, Any]) -> str:
    """sha256 over the canonical JSON encoding of a raw decoded payload."""
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=json_default
    )
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def idempotency_key(observation: Observation, entity_scope: str, time_bucket: str) -> str:
    """§11.2 key: collector + command + entity_scope + server_time_bucket + payload_hash.

    The hash covers the RAW decoded payload, never the normalized row.
    Hashing normalized output would mint new keys on every parser version
    bump and duplicate all history on replay — pinned by a regression test.
    """
    return ":".join(
        [
            str(observation.collector_id),
            observation.source_command,
            entity_scope,
            time_bucket,
            payload_hash(observation.payload),
        ]
    )


def stable_uuid(key: str) -> uuid.UUID:
    """Deterministic UUID for client-generated primary keys.

    Replaying the same observation must regenerate identical parent PKs
    (e.g. arena_snapshots.snapshot_id) so child rows keep pointing at the
    same parent across replays.
    """
    return uuid.uuid5(uuid.NAMESPACE_URL, f"dw-collector:{key}")
