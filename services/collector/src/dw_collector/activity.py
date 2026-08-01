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
        if row.target_table == "alliance_contribution_snapshots":
            facts.append(_contribution_fact(row))
            continue
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


_CONTRIBUTION_METRICS = {
    "daily_donation": "alliance_donation_score",
    "alliance_battle_daily": "alliance_battle_score",
    "alliance_battle_weekly": "alliance_battle_score",
    "alliance_battle_round": "alliance_battle_score",
}


def _contribution_fact(row: NormalizedRow) -> NormalizedRow:
    """A donation score is a measured value, not a participation flag, so the
    fact carries the score itself and its server-reported update time."""
    metric = _CONTRIBUTION_METRICS[row.row["contribution_type"]]
    return NormalizedRow(
        target_table="activity_facts",
        idempotency_key=f"fact:{metric}:{row.idempotency_key}",
        row={
            "occurred_at": row.row["score_updated_at"] or row.row["captured_at"],
            "activity_type": "alliance_contribution",
            "metric_key": metric,
            "value_numeric": row.row["score"] or 0,
            "unit": "points",
            "source_type": "alliance_contribution_snapshots",
            "source_snapshot_id": row.row["snapshot_id"],
            "measurement_type": "observed",
            "confidence": 1.0,
            "schema_version": SCHEMA_VERSION,
        },
        entity_refs=dict(row.entity_refs),
    )
