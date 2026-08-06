"""Announcing things to Discord.

`compose` is pure and turns facts into messages; `worker` decides which facts are
new and posts them. The split is deliberate — the text and the idempotency keys
are what can be wrong in a way nobody notices, so they are testable without a
network.
"""

from __future__ import annotations

__all__ = ["compose", "worker"]
