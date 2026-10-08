"""What redeeming one code for one player can come back as.

The worker knows nothing about HOW a code is redeemed - the official Gift Center
web page, logged in with a player id - only what it can come back as. That keeps
the queue, retry and stop logic testable with a scripted redeemer, and it keeps
the one part nobody has seen yet (the page's real requests and answers) in one
place that is added when they are known.

`raw` is whatever the page answered, verbatim, and is stored on the claim: the
mapping from an answer to a kind is the thing most likely to be wrong the first
time, and the verbatim answer is what makes it fixable without a new capture.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

#: done     the reward was issued
#: already  this player had already redeemed this code
#: expired  the code is no longer valid for anyone
#: invalid  the code is not a code
#: retry    nothing is known about the code; try again later (network, a busy
#:          page, an answer nobody recognises)
#: stop     do not send anything more until a person looks: a challenge was
#:          shown, the page refused us, the account looks flagged
Kind = Literal["done", "already", "expired", "invalid", "retry", "stop"]


@dataclass(frozen=True)
class RedeemResult:
    kind: Kind
    raw: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class Redeemer(Protocol):
    def redeem(self, game_uid: int, code: str) -> RedeemResult: ...
