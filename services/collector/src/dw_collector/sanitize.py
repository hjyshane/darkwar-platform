"""Fixture sanitizers: real captures in, committable fixtures out.

Deterministic by design — running the extractor twice over the same pcap
yields byte-identical fixtures. Sanitized: player uids (server suffix
preserved — uid embeds the home server, see D-1), names, map coordinates
(pointId), and the alliance id. Structure, field names, and every other
value stay exactly as decoded, because the fixture's job is to pin the real
protocol shape.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from typing import Any

UID_SUFFIX_LEN = 6


def _fake_uid(index: int, original: str) -> str:
    suffix = original[-UID_SUFFIX_LEN:] if len(original) > UID_SUFFIX_LEN else original
    return f"9{index:09d}{suffix}"


def sanitize_al_rank(payload: dict[str, Any]) -> dict[str, Any]:
    members = payload.get("list")
    if not isinstance(members, list):
        return payload

    uid_map: dict[str, str] = {}
    for index, member in enumerate(members, start=1):
        original = str(member.get("uid", ""))
        if original:
            uid_map[original] = _fake_uid(index, original)

    sanitized_members = []
    for index, member in enumerate(members, start=1):
        clean = dict(member)
        if "uid" in clean:
            clean["uid"] = uid_map.get(str(clean["uid"]), _fake_uid(index, str(clean["uid"])))
        if "name" in clean:
            clean["name"] = f"Member{index:02d}"
        if clean.get("pointId"):
            clean["pointId"] = 100000 + index
        sanitized_members.append(clean)

    sanitized = dict(payload)
    sanitized["list"] = sanitized_members
    if isinstance(payload.get("allianceId"), str):
        sanitized["allianceId"] = hashlib.md5(str(payload["allianceId"]).encode()).hexdigest()
    officials = payload.get("allianceOfficialArr")
    if isinstance(officials, list):
        sanitized["allianceOfficialArr"] = [
            {**o, "uid": uid_map.get(str(o.get("uid")), str(o.get("uid")))} for o in officials
        ]
    return sanitized


SANITIZERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "al.rank": sanitize_al_rank,
}
