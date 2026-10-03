"""Scout and battle report mails → battle_report_ingests, undecoded.

Every report the game mails — a scout result, an attack on a player or a
tower, a defence, a rally — carries its body as base64 protobuf under one of
two keys in `contentsLocal.obj`:

    scoutContent   scout results (mail type 8)
    battleContent  battle reports (types 72, 93, 109, 126, 157 so far)

Routing is by that key, not by type, so a report type nobody has listed yet
is kept rather than lost. The body is stored as it came: the field meanings
are being matched against labelled screenshots (capture-sweep, 2026-10-02)
and a decoder written now would be guesswork. Keeping the bodies from today
means the history is there when it is not.

The bodies arrive with the inbox page (chat.get.system.mails) or as the mail
is pushed (push.mail), and opening a report sends nothing new. The same
report can therefore reach the journal more than once, and under a
different mail uid for every recipient. The key is the body itself, in one
namespace whichever command delivered it.

`raw` is the mail WITHOUT its body: the body is report_content already, and
at 10-20KB a report it is most of the row.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid

PARSER_VERSION = "1.0.0"
KEY_COMMAND = "report.mail"

# Body key -> battle_report_ingests.report_kind. `mail_simple` is the kind
# mail.read.share has always written for the same battleContent body.
BODY_KINDS: dict[str, str] = {
    "scoutContent": "scout",
    "battleContent": "mail_simple",
}


def _body(raw_mail: dict[str, Any]) -> tuple[str, str] | None:
    contents = raw_mail.get("contentsLocal")
    if not isinstance(contents, str) or not contents.startswith("{"):
        return None
    try:
        parsed = json.loads(contents)
    except json.JSONDecodeError:
        return None
    obj = parsed.get("obj") if isinstance(parsed, dict) else None
    if not isinstance(obj, dict):
        return None
    for key, kind in BODY_KINDS.items():
        value = obj.get(key)
        if isinstance(value, str) and value:
            return kind, value
    return None


def _game_uid(value: Any) -> int | None:
    """Empty is genuinely empty: system-generated reports have no sender."""
    return int(value) if isinstance(value, str) and value.isdigit() else None


def _epoch_ms(value: Any) -> str | None:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        return None
    return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat()


def _marker(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def ingest_rows(observation: Observation, raw_mail: dict[str, Any]) -> list[NormalizedRow]:
    """One row for a report mail, none for any other mail."""
    found = _body(raw_mail)
    if found is None:
        return []
    kind, content = found
    key = entry_idempotency_key(
        observation,
        f"report:{kind}",
        "-",
        {"content": content},
        key_command=KEY_COMMAND,
    )
    mail_type = raw_mail.get("type")
    uid = raw_mail.get("uid")
    return [
        NormalizedRow(
            target_table="battle_report_ingests",
            idempotency_key=key,
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": observation.captured_at.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": {k: v for k, v in raw_mail.items() if k != "contentsLocal"},
                "ingest_id": str(stable_uuid(key)),
                "report_kind": kind,
                "mail_uid": uid if isinstance(uid, str) else None,
                "mail_type": mail_type if isinstance(mail_type, int) else None,
                "from_game_uid": _game_uid(raw_mail.get("fromUser")),
                "to_game_uid": _game_uid(raw_mail.get("toUser")),
                "sent_at": _epoch_ms(raw_mail.get("sendTime")),
                "expires_at": _epoch_ms(raw_mail.get("expireTime")),
                "report_content": content,
                "report_marker": _marker(raw_mail.get("custom")),
            },
        )
    ]
