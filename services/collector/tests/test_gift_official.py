"""OfficialRedeemer against a scripted Gift Center: the answers seen on 2026-10-09."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from dw_collector.gift.official import OfficialRedeemer


def make(handler: Any) -> OfficialRedeemer:
    client = httpx.Client(
        base_url="https://giftcenter.test", transport=httpx.MockTransport(handler)
    )
    return OfficialRedeemer(client)


def json_reply(body: dict[str, Any], status: int = 200) -> Any:
    return lambda request: httpx.Response(status, json=body)


def test_request_carries_uid_code_and_usertoken_header() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"errorCode": "ok", "message": "ok"})

    result = make(handler).redeem(1135062125000580, "ABC123")
    assert result.kind == "done"
    req = seen[0]
    assert req.url.path == "/code.php"
    assert req.url.params["uid"] == "1135062125000580"
    assert req.url.params["code"] == "ABC123"
    assert req.headers["Usertoken"] == "1135062125000580"


@pytest.mark.parametrize(
    ("body", "kind"),
    [
        ({"errorCode": "ok"}, "done"),
        ({"errorCode": "E004", "message": "x"}, "invalid"),
        ({"errorCode": "E005", "message": "x"}, "expired"),
        ({"errorCode": "E006", "message": "x"}, "already"),
        ({"errorCode": "E007", "message": "x"}, "retry"),
        ({"errorCode": "E009", "message": "in cd"}, "retry"),
        ({"errorCode": "E001", "message": "x"}, "retry"),
        ({"errorCode": "E999", "message": "new"}, "retry"),
        ({"code": 10018, "message": "params error"}, "retry"),
        ({"code": 10020, "message": "x"}, "stop"),
        ({"code": 10022, "message": "x"}, "stop"),
        ({"something": "else"}, "retry"),
    ],
)
def test_answers_map_to_kinds(body: dict[str, Any], kind: str) -> None:
    result = make(json_reply(body)).redeem(1, "C")
    assert result.kind == kind
    assert result.raw == body  # verbatim, so a wrong mapping is fixable


@pytest.mark.parametrize("status", [403, 429, 503])
def test_block_statuses_stop(status: int) -> None:
    result = make(json_reply({"errorCode": "ok"}, status)).redeem(1, "C")
    assert result.kind == "stop"


def test_non_json_body_stops() -> None:
    result = make(lambda r: httpx.Response(200, text="<html>challenge</html>")).redeem(1, "C")
    assert result.kind == "stop"
    assert "challenge" in result.raw["body"]


def test_network_error_retries() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    result = make(boom).redeem(1, "C")
    assert result.kind == "retry"
    assert "ConnectError" in (result.error or "")


def test_non_object_json_retries() -> None:
    result = make(lambda r: httpx.Response(200, json=[1, 2])).redeem(1, "C")
    assert result.kind == "retry"
