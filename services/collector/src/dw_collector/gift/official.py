"""The official Gift Center, called the way its own web page calls it.

One GET per pair: `code.php?uid=<player id>&code=<code>` with the player id
repeated in a `Usertoken` header (the page's login step, `getcodeuser.php`, only
fetches the profile for display and is not needed to redeem). Seen on
2026-10-09 against the live page with a deliberately wrong code:

* no header          -> {"code": 10018, "message": "params error"}
* with the header    -> {"errorCode": "E009", "message": "in cd"}

The page's own bundle maps the answers: `errorCode` "ok" is a redemption, E004
the code does not exist, E005 expired, E006 already used, E007 a limit,
E009 try again, E001-E003 and E008 a system error. Numeric `code` answers
(10018 wrong uid, 10020 too frequent, 10022 account alert, 10006 token) come
from the login layer.

Anything not recognised is `retry` with the answer kept verbatim, so a wrong
mapping is fixable from the stored result. Anything that looks like a block
(HTTP 403/429/503, a non-JSON body) is `stop`: no retrying around it.
"""

from __future__ import annotations

from typing import Any

import httpx

from dw_collector.gift.redeemer import Kind, RedeemResult

BASE_URL = "https://giftcenter.darkwar-survival.com"

_BY_ERROR_CODE: dict[str, Kind] = {
    "ok": "done",
    "E004": "invalid",
    "E005": "expired",
    "E006": "already",
    # Redemption limit: unclear whether per player or for the code, so it is
    # not allowed to retire the code for everyone.
    "E007": "retry",
    "E009": "retry",
    "E001": "retry",
    "E002": "retry",
    "E003": "retry",
    "E008": "retry",
}

#: Numeric answers from the login layer. 10018 is about THIS player's id, not
#: the account we are acting from, so it fails the pair rather than halting.
_BY_NUMERIC_CODE: dict[int, Kind] = {
    10018: "retry",
    # "token expired" for EVERY request, not for one player (seen 2026-10-10):
    # nothing can be sent, so stop and let a person look.
    10006: "stop",
    10007: "retry",
    10020: "stop",
    10022: "stop",
}

_BLOCK_STATUSES = frozenset({403, 429, 503})


class OfficialRedeemer:
    def __init__(self, client: httpx.Client | None = None, *, base_url: str = BASE_URL) -> None:
        self.client = client or httpx.Client(
            base_url=base_url,
            timeout=20.0,
            headers={"User-Agent": "Mozilla/5.0"},
        )

    def redeem(self, game_uid: int, code: str) -> RedeemResult:
        uid = str(game_uid)
        try:
            resp = self.client.get(
                "/code.php",
                params={"uid": uid, "code": code},
                headers={"Usertoken": uid},
            )
        except httpx.HTTPError as exc:
            return RedeemResult("retry", error=f"{type(exc).__name__}: {exc}")

        if resp.status_code in _BLOCK_STATUSES:
            return RedeemResult(
                "stop",
                raw={"http_status": resp.status_code, "body": resp.text[:500]},
                error=f"the Gift Center answered HTTP {resp.status_code}",
            )
        try:
            body = resp.json()
        except ValueError:
            return RedeemResult(
                "stop",
                raw={"http_status": resp.status_code, "body": resp.text[:500]},
                error="the Gift Center answered something that is not JSON",
            )
        if not isinstance(body, dict):
            return RedeemResult("retry", raw={"body": body}, error="unexpected answer shape")
        return _classify(body)


def _classify(body: dict[str, Any]) -> RedeemResult:
    error_code = body.get("errorCode")
    if isinstance(error_code, str):
        kind = _BY_ERROR_CODE.get(error_code)
        if kind is not None:
            err = None if kind in ("done", "already") else f"{error_code}: {body.get('message')}"
            return RedeemResult(kind, raw=body, error=err)
        return RedeemResult("retry", raw=body, error=f"unrecognised errorCode {error_code!r}")

    numeric = body.get("code")
    if isinstance(numeric, int):
        kind = _BY_NUMERIC_CODE.get(numeric)
        if kind is not None:
            return RedeemResult(kind, raw=body, error=f"{numeric}: {body.get('message')}")
    return RedeemResult("retry", raw=body, error="unrecognised answer")
