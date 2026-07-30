"""mail.read.share → battle_report_ingests.

A battle report reaches the collector as a mail. Two fields identify it:

    custom         {"c":{"battleReportSimple":{...}}}   ← the marker
    contentsLocal  {"obj":{"battleContent":"<base64>"}} ← the report body

The body is protobuf and is stored undecoded — no .proto ships with the game
and the field meanings are unknown, so decoding now would be invention. What
this parser does is make sure the reports are *kept* from today, so there is
history to analyse once the schema is worked out.

Mails without the marker are ignored: this response also carries ordinary
alliance and system mail, which belongs to no table we have.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"
REPORT_MARKER = "battleReportSimple"


class _Mail(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    type: int | None = None
    custom: str | None = None
    contents_local: str | None = Field(default=None, alias="contentsLocal")
    from_user: str | None = Field(default=None, alias="fromUser")
    to_user: str | None = Field(default=None, alias="toUser")
    send_time: int | None = Field(default=None, alias="sendTime")
    expire_time: int | None = Field(default=None, alias="expireTime")


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    messages: list[_Mail] = Field(alias="msg")


def _game_uid(value: str | None) -> int | None:
    """Empty is genuinely empty: system-generated reports have no sender."""
    return int(value) if value and value.isdigit() else None


def _epoch_ms(value: int | None) -> str | None:
    if not value:
        return None
    return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat()


def _json_or_none(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


@register("mail.read.share")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_messages: list[dict[str, Any]] = observation.payload.get("msg", [])

    rows: list[NormalizedRow] = []
    for mail, raw_mail in zip(payload.messages, raw_messages, strict=True):
        if not mail.custom or REPORT_MARKER not in mail.custom:
            continue
        body = _json_or_none(mail.contents_local) or {}
        content = (
            body.get("obj", {}).get("battleContent") if isinstance(body.get("obj"), dict) else None
        )
        rows.append(
            NormalizedRow(
                target_table="battle_report_ingests",
                idempotency_key=idempotency_key(observation, f"mail:{mail.uid}", bucket),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_mail,
                    "mail_uid": mail.uid,
                    "mail_type": mail.type,
                    "from_game_uid": _game_uid(mail.from_user),
                    "to_game_uid": _game_uid(mail.to_user),
                    "sent_at": _epoch_ms(mail.send_time),
                    "expires_at": _epoch_ms(mail.expire_time),
                    "report_content": content if isinstance(content, str) else None,
                    "report_marker": _json_or_none(mail.custom),
                },
            )
        )
    return rows
