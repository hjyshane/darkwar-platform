"""Command → normalizer dispatch.

Unknown commands are not errors (FR-COL-003): the router records them for
the discovery inbox and moves on. Registration happens at import time via
the @register decorator; dw_collector.normalize imports every normalizer
module for its side effects.
"""

from __future__ import annotations

from collections.abc import Callable

from dw_collector.models import NormalizedRow, Observation

Normalizer = Callable[[Observation], list[NormalizedRow]]

_registry: dict[str, Normalizer] = {}


def register(command: str) -> Callable[[Normalizer], Normalizer]:
    def decorator(fn: Normalizer) -> Normalizer:
        if command in _registry:
            msg = f"normalizer already registered for {command!r}"
            raise ValueError(msg)
        _registry[command] = fn
        return fn

    return decorator


def get(command: str) -> Normalizer | None:
    return _registry.get(command)


def known_commands() -> frozenset[str]:
    return frozenset(_registry)
