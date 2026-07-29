"""Observation → normalized rows + derived facts, in one pass.

The seam every producer (replay CLI today, live capture at S15) goes
through: normalize via the registry, then derive activity facts. The
result lands in the journal as ONE transaction, so facts can never exist
without the snapshot rows they point at.
"""

from __future__ import annotations

from dw_collector import registry
from dw_collector.activity import emit_facts
from dw_collector.discovery import discovery_row
from dw_collector.models import NormalizedRow, Observation


class UnknownCommandError(Exception):
    def __init__(self, command: str) -> None:
        super().__init__(command)
        self.command = command


def process(observation: Observation) -> list[NormalizedRow]:
    normalizer = registry.get(observation.source_command)
    if normalizer is None:
        raise UnknownCommandError(observation.source_command)
    rows = normalizer(observation)
    return rows + emit_facts(observation, rows)


def observe(observation: Observation) -> list[NormalizedRow]:
    """process(), but an unrecognized command becomes a discovery row.

    FR-COL-003: an unknown or malformed payload must never stop collection.
    Bulk paths (capture scan, live capture at S15) use this; `replay` keeps
    using process() so a typo in a fixture is still an error.
    """
    try:
        return process(observation)
    except UnknownCommandError:
        return [discovery_row(observation)]
