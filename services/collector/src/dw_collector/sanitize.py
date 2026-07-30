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
import json
from collections.abc import Callable
from typing import Any

UID_SUFFIX_LEN = 6


def _fake_uid(original: str) -> str:
    """Content-derived fake uid: the same real player maps to the same fake
    uid in EVERY fixture (CBFW members genuinely appear in both the roster
    and the arena Top100), and distinct players cannot collide the way an
    index-based mapping does. The server suffix survives (D-1)."""
    suffix = original[-UID_SUFFIX_LEN:] if len(original) > UID_SUFFIX_LEN else original
    digest = int(hashlib.sha256(original.encode()).hexdigest(), 16) % 10**9
    return f"9{digest:09d}{suffix}"


def sanitize_al_rank(payload: dict[str, Any]) -> dict[str, Any]:
    members = payload.get("list")
    if not isinstance(members, list):
        return payload

    sanitized_members = []
    for index, member in enumerate(members, start=1):
        clean = dict(member)
        if "uid" in clean:
            clean["uid"] = _fake_uid(str(clean["uid"]))
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
            {**o, "uid": _fake_uid(str(o.get("uid", "")))} for o in officials
        ]
    return sanitized


def sanitize_user_get_arena_info(payload: dict[str, Any]) -> dict[str, Any]:
    entries = payload.get("rankArr")
    if not isinstance(entries, list):
        return payload

    sanitized_entries = []
    for index, entry in enumerate(entries, start=1):
        clean = dict(entry)
        if "uid" in clean:
            clean["uid"] = _fake_uid(str(clean["uid"]))
        if "name" in clean:
            clean["name"] = f"Arena{index:03d}"
        if clean.get("alName"):
            clean["alName"] = f"Alliance{index:02d}"
        if clean.get("abbr"):
            clean["abbr"] = f"A{index:03d}"
        # Defense lineup blob: opaque protobuf of the player's troops.
        if "army" in clean:
            clean["army"] = ""
        if clean.get("mainBuildPoint"):
            clean["mainBuildPoint"] = 100000 + index
        sanitized_entries.append(clean)

    sanitized = dict(payload)
    sanitized["rankArr"] = sanitized_entries
    # Top-level power/army describe the COLLECTOR account.
    if "power" in sanitized:
        sanitized["power"] = 100000000
    if "army" in sanitized:
        sanitized["army"] = ""
    return sanitized


def _fake_alliance_id(original: str) -> str:
    """Same md5 mapping sanitize_al_rank uses for allianceId, so one real
    alliance keeps one fake id across every fixture."""
    return hashlib.md5(original.encode()).hexdigest()


def sanitize_alliance_rank(payload: dict[str, Any]) -> dict[str, Any]:
    entries = payload.get("allianceRanking")
    if not isinstance(entries, list):
        return payload

    sanitized_entries = []
    for index, entry in enumerate(entries, start=1):
        clean = dict(entry)
        if "uid" in clean:
            clean["uid"] = _fake_alliance_id(str(clean["uid"]))
        if clean.get("alliancename"):
            clean["alliancename"] = f"Alliance{index:02d}"
        if clean.get("abbr"):
            clean["abbr"] = f"A{index:03d}"
        if clean.get("leader"):
            clean["leader"] = f"Leader{index:02d}"
        sanitized_entries.append(clean)

    sanitized = dict(payload)
    sanitized["allianceRanking"] = sanitized_entries
    # The collector account's own alliance power.
    if "selfPower" in sanitized:
        sanitized["selfPower"] = 10000000000
    return sanitized


def sanitize_get_al_info(payload: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(payload)
    if isinstance(payload.get("uid"), str):
        sanitized["uid"] = _fake_alliance_id(str(payload["uid"]))
    if payload.get("leaderUid"):
        sanitized["leaderUid"] = _fake_uid(str(payload["leaderUid"]))
    for key, replacement in (
        ("name", "Alliance Detail"),
        ("abbr", "ADET"),
        ("leaderName", "Leader01"),
        # Free text written by players; never worth committing verbatim.
        ("announce", "[redacted announcement]"),
        ("intro", "[redacted intro]"),
    ):
        if payload.get(key):
            sanitized[key] = replacement
    return sanitized


def sanitize_server_rank(payload: dict[str, Any]) -> dict[str, Any]:
    entries = payload.get("serverRanking")
    if not isinstance(entries, list):
        return payload

    sanitized_entries = []
    for index, entry in enumerate(entries, start=1):
        clean = dict(entry)
        if "uid" in clean:
            clean["uid"] = _fake_uid(str(clean["uid"]))
        if clean.get("name"):
            clean["name"] = f"Ranked{index:03d}"
        if clean.get("allianceName"):
            clean["allianceName"] = f"Alliance{index:02d}"
        if clean.get("abbr"):
            clean["abbr"] = f"A{index:03d}"
        sanitized_entries.append(clean)

    sanitized = dict(payload)
    sanitized["serverRanking"] = sanitized_entries
    if "selfPower" in sanitized:
        sanitized["selfPower"] = 100000000
    return sanitized


def _sanitize_profile(profile: dict[str, Any], label: str) -> dict[str, Any]:
    """Shared field masking for the two player-profile responses."""
    clean = dict(profile)
    if clean.get("uid"):
        clean["uid"] = _fake_uid(str(clean["uid"]))
    if clean.get("name"):
        clean["name"] = label
    if clean.get("allianceId"):
        clean["allianceId"] = _fake_alliance_id(str(clean["allianceId"]))
    if clean.get("allianceName"):
        clean["allianceName"] = "Alliance01"
    if clean.get("allianceAbbrName"):
        clean["allianceAbbrName"] = "A001"
    if clean.get("abbr"):
        clean["abbr"] = "A001"
    # Player-written profile text.
    if clean.get("info"):
        clean["info"] = []
    return clean


def sanitize_get_new_user_info(payload: dict[str, Any]) -> dict[str, Any]:
    return _sanitize_profile(payload, "ProfilePlayer")


def sanitize_get_user_info_multi(payload: dict[str, Any]) -> dict[str, Any]:
    entries = payload.get("uids")
    if not isinstance(entries, list):
        return payload
    sanitized = dict(payload)
    sanitized["uids"] = [
        _sanitize_profile(entry, f"MultiPlayer{index:02d}")
        for index, entry in enumerate(entries, start=1)
    ]
    return sanitized


def sanitize_daily_alliance_donate_rank(payload: dict[str, Any]) -> dict[str, Any]:
    entries = payload.get("rankList")
    if not isinstance(entries, list):
        return payload
    sanitized = dict(payload)
    # Scores and update times are the data; only the identity is masked.
    sanitized["rankList"] = [{**e, "uid": _fake_uid(str(e.get("uid", "")))} for e in entries]
    return sanitized


def sanitize_kill_rank(payload: dict[str, Any]) -> dict[str, Any]:
    """Same masking as server.rank — the two responses differ in the metric
    they report, not in the identities they expose."""
    return sanitize_server_rank(payload)


BATTLE_CONTENT_KEEP = 64


def sanitize_mail_read_share(payload: dict[str, Any]) -> dict[str, Any]:
    """Mail carrying a battle report.

    The report body is another player's full army composition, so the fixture
    keeps only its first characters — enough to prove the parser extracts the
    right field, without committing someone's battle to the repo. A decoder,
    when it exists, will need its own deliberately captured sample.
    """
    messages = payload.get("msg")
    if not isinstance(messages, list):
        return payload

    sanitized_messages = []
    for index, mail in enumerate(messages, start=1):
        clean = dict(mail)
        for key in ("uid", "fromUser", "toUser"):
            if clean.get(key):
                clean[key] = _fake_uid(str(clean[key]))
        if clean.get("fromName"):
            clean["fromName"] = f"Sender{index:02d}"
        local = clean.get("contentsLocal")
        if isinstance(local, str) and local:
            try:
                body = json.loads(local)
            except json.JSONDecodeError:
                body = None
            if isinstance(body, dict) and isinstance(body.get("obj"), dict):
                content = body["obj"].get("battleContent")
                if isinstance(content, str):
                    body["obj"]["battleContent"] = content[:BATTLE_CONTENT_KEEP]
                clean["contentsLocal"] = json.dumps(body, ensure_ascii=False)
        sanitized_messages.append(clean)

    sanitized = dict(payload)
    sanitized["msg"] = sanitized_messages
    return sanitized


def sanitize_get_fight_report_detail(payload: dict[str, Any]) -> dict[str, Any]:
    """Same reasoning as the mail body: a report is somebody's full army
    composition, so the fixture keeps only enough to prove the parser reads
    the right field."""
    sanitized = dict(payload)
    contents = payload.get("contents")
    if isinstance(contents, str):
        sanitized["contents"] = contents[:BATTLE_CONTENT_KEEP]
    return sanitized


SANITIZERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "get.fight.report.detail": sanitize_get_fight_report_detail,
    "mail.read.share": sanitize_mail_read_share,
    "kill.rank": sanitize_kill_rank,
    "get.daily.alliance.donate.rank": sanitize_daily_alliance_donate_rank,
    "al.rank": sanitize_al_rank,
    "alliance.rank": sanitize_alliance_rank,
    "get.al.info": sanitize_get_al_info,
    "get.new.user.info": sanitize_get_new_user_info,
    "get.user.info.multi": sanitize_get_user_info_multi,
    "server.rank": sanitize_server_rank,
    "user.get.arena.info": sanitize_user_get_arena_info,
}
