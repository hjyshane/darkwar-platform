"""Unknown-command discovery inbox (FR-COL-008, FR-OPS-004).

An unrecognized command is not an error — it is the raw material for the
next parser. Captures already contain dozens of them (push.battle.round.batch,
push.world.march.new, mori.note.draw, …), and the event/season/battle-report
protocols will first appear here.

What gets recorded is the SHAPE, never the values: a nested key→type
skeleton plus a hash of it. That keeps uid/session material out of a table
admins read in a browser, and it is what the reviewer actually needs to
decide whether a command deserves a parser.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from dw_collector.models import NormalizedRow, Observation

MAX_DEPTH = 4


def payload_shape(value: Any, depth: int = 0) -> Any:
    """Types and keys only — no values survive this."""
    if isinstance(value, dict):
        if depth >= MAX_DEPTH:
            return "object"
        return {key: payload_shape(item, depth + 1) for key, item in sorted(value.items())}
    if isinstance(value, list):
        if depth >= MAX_DEPTH:
            return "array"
        # A list is homogeneous in practice; one element describes it, and
        # an empty list still carries "array" as its shape.
        return [payload_shape(value[0], depth + 1)] if value else []
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, bytes):
        return "bytes"
    return "null"


def fingerprint(shape: Any) -> str:
    canonical = json.dumps(shape, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:32]


def discovery_row(observation: Observation) -> NormalizedRow:
    """One schema_observations row for an unrecognized command."""
    shape = payload_shape(observation.payload)
    print_ = fingerprint(shape)
    return NormalizedRow(
        target_table="schema_observations",
        # Deduped on (source_command, fingerprint) cloud-side; the same
        # shape seen twice must not create two rows.
        idempotency_key=f"schema:{observation.source_command}:{print_}",
        conflict_target="source_command,fingerprint",
        row={
            "collector_id": str(observation.collector_id),
            "source_command": observation.source_command,
            "fingerprint": print_,
            "sample": shape,
            "first_seen_at": observation.captured_at.isoformat(),
            "last_seen_at": observation.captured_at.isoformat(),
        },
    )
