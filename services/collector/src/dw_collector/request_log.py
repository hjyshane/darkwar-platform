"""Client → server requests: masking before storage, and the Observation builder.

A request is stored so the command catalog can show what the client ASKS for
(the viewport a world-map call names, the version a login announces). It is
never normalized and never synced. What it can carry that a response cannot is
the collector account's own identity — uid, session signature, device id — and
that is exactly what CLAUDE.md says must not reach disk or the cloud, so every
request is masked here before `Journal.record_request` sees it.

Masking is by KEY NAME, not by value shape, because the login request has never
been seen: nothing says which field holds the signature, only that a key called
`sign` or `token` will. The cost of a false positive is one catalog column
showing `<masked:int>`; the cost of a miss is a credential in a SQLite file.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any

from dw_collector.models import Observation

# `uid` anywhere in the key (leaderUid, targetUid, uids): in a request it names
# a person, and the catalog needs the key, not the person.
_SENSITIVE_KEY = re.compile(
    r"uid|sign|sig$|token|session|secret|pass|pwd|ticket|auth|udid|device|imei|"
    r"androidid|cookie|openid|nonce|salt|hash|mac$|^key$",
    re.IGNORECASE,
)
# Keys whose VALUE is the point of recording a login (task: where the client
# announces its version). Still subject to the sensitive pattern above.
_VERSION_KEY = re.compile(r"ver|build|channel|platform|lang|pkg|package", re.IGNORECASE)

# Every value is masked except version-like keys: nobody has ever read one of
# these, so default to showing the shape only.
_SHAPE_ONLY_COMMANDS = frozenset({"account.login.new", "login", "init"})


def _mask_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "str"
    if isinstance(value, bytes):
        return "bytes"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return "null"


def _mask(value: Any) -> str:
    return f"<masked:{_mask_type(value)}>"


def _walk(value: Any, *, shape_only: bool, version_ok: bool = False) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            name = str(key)
            if name == "_id" and isinstance(item, int):
                out[name] = item  # the pairing key; a counter, not an identity
            elif _SENSITIVE_KEY.search(name):
                out[name] = _mask(item)
            else:
                out[name] = _walk(
                    item,
                    shape_only=shape_only,
                    version_ok=bool(_VERSION_KEY.search(name)),
                )
        return out
    if isinstance(value, list):
        return [_walk(item, shape_only=shape_only, version_ok=version_ok) for item in value]
    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"
    if shape_only and not version_ok and value is not None:
        return _mask(value)
    return value


def mask_request(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    """The payload with identity and credential fields replaced by a marker.

    Always returns a new dict. Deterministic, so a replayed capture masks to
    the same bytes. Masked values keep their type (`<masked:int>`) because the
    type is what a catalog reader needs.
    """
    result = _walk(payload, shape_only=command in _SHAPE_ONLY_COMMANDS)
    assert isinstance(result, dict)
    return result


def request_observation(
    *,
    observation_id: uuid.UUID,
    collector_id: uuid.UUID,
    command: str,
    payload: dict[str, Any],
    captured_at: datetime,
    collected_from_server_id: int,
) -> Observation:
    """An outbound Observation with its payload already masked."""
    return Observation(
        observation_id=observation_id,
        collector_id=collector_id,
        source_command=command,
        captured_at=captured_at,
        collected_from_server_id=collected_from_server_id,
        payload=mask_request(command, payload),
        direction="outbound",
    )
