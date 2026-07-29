"""Activity fact emission (S11, FR-ACT-001/008).

Facts are atomic observations, not scores: `arena_participation` records
that a player appeared in an arena ranking — value 1, observed, confidence
1.0. Absence of a fact is absence of observation, never a zero (FR-ACT-004).

Each fact carries source_snapshot_id pointing at the arena_entries row it
was derived from, which itself carries observation_id — the full FR-ACT-008
drill-down chain fact → snapshot → observation → raw payload.
"""

from __future__ import annotations

from dw_collector.models import NormalizedRow, Observation

SCHEMA_VERSION = 1


def emit_facts(observation: Observation, rows: list[NormalizedRow]) -> list[NormalizedRow]:
    """Derive activity facts from freshly normalized rows."""
    facts: list[NormalizedRow] = []
    for row in rows:
        if row.target_table != "arena_entries":
            continue
        facts.append(
            NormalizedRow(
                target_table="activity_facts",
                # Suffix on the ENTRY key: still rooted in the raw payload
                # hash, so parser bumps cannot churn fact keys either.
                idempotency_key=f"fact:arena_participation:{row.idempotency_key}",
                row={
                    "occurred_at": row.row["captured_at"],
                    "activity_type": "arena_participation",
                    "metric_key": "arena_participation",
                    "value_numeric": 1,
                    "unit": "boolean",
                    "source_type": "arena_entries",
                    "source_snapshot_id": row.row["snapshot_id"],
                    "measurement_type": "observed",
                    "confidence": 1.0,
                    "schema_version": SCHEMA_VERSION,
                },
                entity_refs=dict(row.entity_refs),
            )
        )
    return facts
