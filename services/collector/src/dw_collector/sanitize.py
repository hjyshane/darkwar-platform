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

from dw_collector.protocol.worldmap import (
    WorldMapDecodeError,
    decode_point,
    mask_people,
)

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
        # The defence lineup is KEPT. It used to be blanked as an "opaque
        # protobuf", a precaution taken before anyone decoded it. Every field
        # path across 806 real lineups is now accounted for (protocol/army.py):
        # hero ids, slots, levels, stars, equipment, per-hero power, a
        # per-instance hero uuid, and exactly one string — the troop type id,
        # "107009" and friends. No names, no uids, no coordinates, so nothing
        # this module is charged with masking. Blanking it would also leave the
        # lineup parser with no fixture to be tested against.
        if clean.get("mainBuildPoint"):
            clean["mainBuildPoint"] = 100000 + index
        sanitized_entries.append(clean)

    sanitized = dict(payload)
    sanitized["rankArr"] = sanitized_entries
    # Top-level power/army describe the COLLECTOR account. Power is masked
    # because it is a real figure about the operator; the lineup is kept for
    # the same reason the entries' lineups are.
    if "power" in sanitized:
        sanitized["power"] = 100000000
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


def sanitize_alliance_donate_rank(payload: dict[str, Any]) -> dict[str, Any]:
    """Serves both donation rankings. get.week.alliance.donate.rank returns the
    same {uid, score, updateTime} rankList as the daily one — different period,
    identical shape — so masking it twice would be two names for one function."""
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


def sanitize_rank_get_by_range(payload: dict[str, Any]) -> dict[str, Any]:
    """Same masking as server.rank — the boards differ in the metric they
    report, not in the identities they expose. selfPower is the COLLECTOR's
    own component power, so it is replaced too."""
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
        sanitized["selfPower"] = 10000000
    return sanitized


def sanitize_al_battle_rank_info(payload: dict[str, Any]) -> dict[str, Any]:
    """A duel ranking names BOTH alliances, so the mapping has to be per
    alliance rather than per row.

    Numbering alliances by row index — which this did — gave 165 members 165
    different alliance names and destroyed the one structure the fixture
    exists to show: whose score is whose. Distinct real alliances now map to
    distinct fake ones, stable within the payload.
    """
    entries = payload.get("rankInfo")
    if not isinstance(entries, list):
        return payload

    alliances: dict[str, int] = {}
    for entry in entries:
        real = entry.get("alName")
        if real and real not in alliances:
            alliances[real] = len(alliances) + 1

    sanitized = dict(payload)
    sanitized["rankInfo"] = [
        {
            **e,
            "uid": _fake_uid(str(e.get("uid", ""))),
            **({"name": f"Fighter{i:03d}"} if e.get("name") else {}),
            **({"alName": f"Alliance{alliances[e['alName']]:02d}"} if e.get("alName") else {}),
            **(
                {"abbr": f"A{alliances[e['alName']]:02d}"}
                if e.get("alName") and e.get("abbr")
                else {}
            ),
        }
        for i, e in enumerate(entries, start=1)
    ]
    return sanitized


def sanitize_alliance_season_score_rank(payload: dict[str, Any]) -> dict[str, Any]:
    """Season alliance score board (0136).

    One row per alliance, so the per-alliance mapping al.battle.rank.info
    needed is trivially satisfied — but the mapping is keyed on allianceId
    rather than on the row index, so the same alliance keeps the same fake
    identity here and in every other fixture.

    `leader` is a PLAYER's name, not an alliance's. Masked as a person.

    Kept: rank, oldRank, score, power, serverId, country, icon. serverId
    especially — the board reaches servers outside the tracked group (580,
    584, 586, 588 in the real response) and that fact is half of what this
    fixture exists to pin.
    """
    entries = payload.get("rankList")
    if not isinstance(entries, list):
        return payload

    sanitized = dict(payload)
    sanitized["rankList"] = [
        {
            **e,
            **(
                {"allianceId": _fake_alliance_id(str(e["allianceId"]))}
                if isinstance(e.get("allianceId"), str)
                else {}
            ),
            **({"allianceName": f"Alliance{i:02d}"} if e.get("allianceName") else {}),
            **({"abbr": f"A{i:02d}"} if e.get("abbr") else {}),
            **({"leader": f"Leader{i:02d}"} if e.get("leader") else {}),
        }
        for i, e in enumerate(entries, start=1)
    ]
    # selfScore/selfRank/selfOldRank describe the COLLECTOR's own alliance.
    # Masked for the same reason server.rank masks selfPower: it is a real
    # figure about the operator, and no parser reads it.
    if "selfScore" in sanitized:
        sanitized["selfScore"] = 1000
    return sanitized


def sanitize_desert_force_server_rank(payload: dict[str, Any]) -> dict[str, Any]:
    """Season player force board (0136).

    Note the key is `alliancename`, all lower case — the alliance board
    above spells the same concept `allianceName`. That is the game's
    inconsistency, not a typo here, and the fixture must preserve it or the
    parser would be tested against a shape the server never sends.

    No serverId on these entries (0 of 149 in the real response), so the
    parser decodes the home server from the uid. `_fake_uid` preserves the
    trailing six digits precisely so that decode still works on the fixture.
    """
    entries = payload.get("serverRanking")
    if not isinstance(entries, list):
        return payload

    alliances: dict[str, int] = {}
    for entry in entries:
        real = entry.get("allianceId")
        if isinstance(real, str) and real and real not in alliances:
            alliances[real] = len(alliances) + 1

    def _al(entry: dict[str, Any]) -> int:
        return alliances.get(str(entry.get("allianceId")), 0)

    sanitized = dict(payload)
    sanitized["serverRanking"] = [
        {
            **e,
            "uid": _fake_uid(str(e.get("uid", ""))),
            **({"name": f"Force{i:03d}"} if e.get("name") else {}),
            **(
                {"allianceId": _fake_alliance_id(str(e["allianceId"]))}
                if isinstance(e.get("allianceId"), str) and e["allianceId"]
                else {}
            ),
            **({"alliancename": f"Alliance{_al(e):02d}"} if e.get("alliancename") else {}),
            **({"abbr": f"A{_al(e):02d}"} if e.get("abbr") else {}),
        }
        for i, e in enumerate(entries, start=1)
    ]
    if "selfForceValue" in sanitized:
        sanitized["selfForceValue"] = 1000
    return sanitized


def sanitize_world_get_new(payload: dict[str, Any]) -> dict[str, Any]:
    """The map viewport: mask the people, keep the map.

    `points` are base64 protobuf, not JSON, so this is the first sanitizer
    that has to rewrite a binary payload. It decodes each point, replaces the
    city's uid and name, and re-emits every other byte untouched — verified
    on 10,395 real points, where 8,133 non-city entries came back
    byte-identical and 2,262 cities kept their coordinate, type, HQ level and
    server while losing the person.

    Coordinates are deliberately KEPT. They are what the fixture exists to
    pin — the packing, the type ids, the field numbering — and a map with
    invented coordinates would test nothing. What identifies somebody is the
    uid and the name, and both are gone.

    The uid mapping is the shared content-derived one, so the same player is
    the same fake across every fixture; names are numbered by first
    appearance so one player keeps one name within the viewport.
    """
    points = payload.get("points")
    if not isinstance(points, list):
        return payload

    names: dict[str, str] = {}

    def name_for(real: str) -> str:
        if real not in names:
            names[real] = f"City{len(names) + 1:03d}"
        return names[real]

    cleaned: list[str | bytes] = []
    for entry in points:
        if not isinstance(entry, (str, bytes)):
            continue
        try:
            # Decoded only to prove it is readable. Every point then goes
            # through the masker, which finds a person by SHAPE — a city, a
            # season building and a type-21 object each carry a uid, in
            # different fields, and only one of them is a city.
            decode_point(entry)
        except WorldMapDecodeError:
            # A point this build cannot read is dropped rather than copied
            # through unmasked: it might be carrying somebody.
            continue
        cleaned.append(mask_people(entry, uid_for=_fake_uid, name_for=name_for))

    sanitized = dict(payload)
    sanitized["points"] = cleaned
    return sanitized


def _alliance_masker() -> Callable[[str | None], int]:
    """Number alliances by first appearance, so one real alliance keeps one
    fake identity within a payload and two different ones never merge."""
    seen: dict[str, int] = {}

    def number(real: str | None) -> int:
        key = real or ""
        if key not in seen:
            seen[key] = len(seen) + 1
        return seen[key]

    return number


def sanitize_dragon_assign_player_info(payload: dict[str, Any]) -> dict[str, Any]:
    """Black Money signup list (the game calls the event `dragon`).

    Every member of the collector's alliance, with the team and slot the
    officers put them in. Masked: uid (server suffix kept, D-1) and name.
    `abbr` is the member's OWN alliance tag, which is the collector's — one
    tag for the whole list — and is replaced like any alliance identity.

    Kept: power, level, joinTime, state, teamIndex, timeIndexRecord and both
    battleWillingness flags. Those ARE the signup, and the fixture exists to
    pin how the game encodes it.
    """
    users = payload.get("users")
    if not isinstance(users, list):
        return payload

    alliance = _alliance_masker()
    sanitized = dict(payload)
    sanitized["users"] = [
        {
            **u,
            "uid": _fake_uid(str(u.get("uid", ""))),
            **({"name": f"Member{i:02d}"} if u.get("name") else {}),
            **({"abbr": f"A{alliance(u['abbr']):02d}"} if u.get("abbr") else {}),
        }
        for i, u in enumerate(users, start=1)
    ]
    return sanitized


def sanitize_dragon_battle_history(payload: dict[str, Any]) -> dict[str, Any]:
    """Black Money battle history: one entry per team per event.

    `enemyAllianceId` on the real response is OUR alliance id on every
    entry that carries it — the game's bug, not ours. The same md5 mapping is applied to
    both fields, so the fixture keeps that equality and the parser's refusal
    to trust the field stays testable.
    """
    entries = payload.get("historyArr")
    if not isinstance(entries, list):
        return payload

    alliance = _alliance_masker()

    def masked(e: dict[str, Any]) -> dict[str, Any]:
        clean = dict(e)
        for field in ("allianceId", "enemyAllianceId"):
            if isinstance(clean.get(field), str) and clean[field]:
                clean[field] = _fake_alliance_id(clean[field])
        if clean.get("name"):
            n = alliance(clean["name"])
            clean["name"] = f"Alliance{n:02d}"
            if clean.get("abbr"):
                clean["abbr"] = f"A{n:02d}"
        if clean.get("enemyName"):
            n = alliance(clean["enemyName"])
            clean["enemyName"] = f"Alliance{n:02d}"
            if clean.get("enemyAbbr"):
                clean["enemyAbbr"] = f"A{n:02d}"
        return clean

    sanitized = dict(payload)
    sanitized["historyArr"] = [masked(e) for e in entries]
    return sanitized


# The one system-mail type a parser reads. Everything else in the inbox —
# rally reports, deliveries, the collector's own reward mail — is dropped
# from a fixture rather than masked: none of it is needed to pin the report's
# shape, and each type would need its own proof that nothing personal survives.
BLACK_MONEY_REPORT_MAIL_TYPE = 147


def sanitize_chat_get_system_mails(payload: dict[str, Any]) -> dict[str, Any]:
    """A page of the collector's system inbox, cut down to Black Money
    battle reports and masked.

    A report's body is a JSON STRING (`contentsLocal`) holding both sides of
    the battle: alliance id, name and tag per side, and every participant's
    uid and name. All of those are masked, and the string is re-encoded the
    way the server sends it, so the parser still has to decode it.

    `toUser` is the collector's own uid and is remapped like any other.
    Mail uids, timestamps, dialog ids and every score stay as decoded.
    """
    mails = payload.get("msg")
    if not isinstance(mails, list):
        return payload

    alliance = _alliance_masker()
    player_names: dict[str, str] = {}

    def player_name(uid: str) -> str:
        if uid not in player_names:
            player_names[uid] = f"Player{len(player_names) + 1:03d}"
        return player_names[uid]

    def masked_side(side: dict[str, Any]) -> dict[str, Any]:
        clean = dict(side)
        n = alliance(str(side.get("allianceId")))
        if isinstance(clean.get("allianceId"), str):
            clean["allianceId"] = _fake_alliance_id(clean["allianceId"])
        if clean.get("name"):
            clean["name"] = f"Alliance{n:02d}"
        if clean.get("abbr"):
            clean["abbr"] = f"A{n:02d}"
        clean["userArr"] = [
            {
                **u,
                "uid": _fake_uid(str(u.get("uid", ""))),
                **({"name": player_name(str(u.get("uid")))} if u.get("name") else {}),
                **({"abbr": f"A{n:02d}"} if u.get("abbr") else {}),
            }
            for u in side.get("userArr", [])
        ]
        return clean

    kept = []
    for mail in mails:
        if mail.get("type") != BLACK_MONEY_REPORT_MAIL_TYPE:
            continue
        clean = dict(mail)
        if clean.get("toUser"):
            clean["toUser"] = _fake_uid(str(clean["toUser"]))
        body = json.loads(clean["contentsLocal"])
        obj = body.get("obj", {})
        if isinstance(obj.get("allianceId"), str):
            obj["allianceId"] = _fake_alliance_id(obj["allianceId"])
        obj["scoreInfo"] = [masked_side(s) for s in obj.get("scoreInfo", [])]
        clean["contentsLocal"] = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        kept.append(clean)

    sanitized = dict(payload)
    sanitized["msg"] = kept
    return sanitized


def sanitize_push_mail(payload: dict[str, Any]) -> dict[str, Any]:
    """One pushed mail. A Black Gold report is masked exactly as it is on the
    inbox page. ANY OTHER MAIL keeps its type and uid and nothing else:
    push.mail carries player-to-player messages, and no fixture may hold one.
    """
    if payload.get("type") != BLACK_MONEY_REPORT_MAIL_TYPE:
        return {"type": payload.get("type"), "uid": payload.get("uid")}
    page: list[dict[str, Any]] = sanitize_chat_get_system_mails({"msg": [payload]})["msg"]
    return page[0]


def sanitize_dragon_activity_info(payload: dict[str, Any]) -> dict[str, Any]:
    """The current Black Gold event: both teams, their matchups and, once
    fought, the results. One real alliance maps to one fake identity across
    the matchup AND the result rows, so the parser's "ours is the alliance in
    every matchup" rule still has something to find."""
    teams = payload.get("teamArr")
    if not isinstance(teams, list):
        return payload

    alliance = _alliance_masker()

    def masked_side(side: dict[str, Any]) -> dict[str, Any]:
        clean = dict(side)
        n = alliance(str(side.get("allianceId")))
        if isinstance(clean.get("allianceId"), str):
            clean["allianceId"] = _fake_alliance_id(clean["allianceId"])
        if clean.get("name"):
            clean["name"] = f"Alliance{n:02d}"
        if clean.get("abbr"):
            clean["abbr"] = f"A{n:02d}"
        return clean

    def masked_team(team: dict[str, Any]) -> dict[str, Any]:
        clean = dict(team)
        clean["vsInfoArr"] = [masked_side(s) for s in team.get("vsInfoArr", [])]
        if isinstance(team.get("resultInfo"), list):
            clean["resultInfo"] = [
                {**r, "allianceId": _fake_alliance_id(str(r.get("allianceId")))}
                for r in team["resultInfo"]
            ]
        return clean

    sanitized = dict(payload)
    sanitized["teamArr"] = [masked_team(t) for t in teams]
    return sanitized


# Enough of each list to exercise the parser; a whole account's inventory is
# not needed to prove the shape, and is more of an account than a fixture
# should carry.
_INIT_LIST_LIMIT = 8

_INIT_FIELDS: dict[str, tuple[str, ...]] = {
    "items": ("itemId", "count"),
    "building_new": ("bId", "lv"),
    "heroEquips": ("equipId", "heroId", "level", "promote"),
    "heroIntensifys": ("heroId", "lv"),
    "modCarEquipArr": ("equipId", "lv"),
    "science_new": ("itemId", "level"),
    "heroEquipUniques": ("equipId", "heroId", "level"),
    # Timed buffs (account_state._timed): no identity in them.
    "status": ("effNum", "effVal", "startTime", "endTime", "stateId"),
}


def sanitize_init(payload: dict[str, Any]) -> dict[str, Any]:
    """The login response, cut down to what the account_state parser reads.

    Everything else in `init` — linked sign-in names, mail, chat, purchase
    state, formations — is dropped outright rather than masked: nothing reads
    it, so there is no shape to preserve. The uid keeps its server suffix
    and the character's name is replaced.
    """
    raw_user = payload.get("user")
    user: dict[str, Any] = raw_user if isinstance(raw_user, dict) else {}
    clean: dict[str, Any] = {
        "user": {
            "uid": _fake_uid(str(user.get("uid", ""))),
            "serverId": user.get("serverId"),
            "name": "Player01",
        }
    }
    for key, fields in _INIT_FIELDS.items():
        entries = payload.get(key)
        if not isinstance(entries, list):
            continue
        clean[key] = [
            {field: entry[field] for field in fields if field in entry}
            for entry in entries[:_INIT_LIST_LIMIT]
            if isinstance(entry, dict)
        ]
    # The server's buff totals: effect id -> number, nothing personal.
    if isinstance(payload.get("effect"), dict):
        clean["effect"] = dict(payload["effect"])
    # Resource stock: key -> amount, nothing personal.
    if isinstance(payload.get("resource"), dict):
        clean["resource"] = dict(payload["resource"])
    return clean


SANITIZERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "init": sanitize_init,
    "push.mail": sanitize_push_mail,
    "dragon.activity.info": sanitize_dragon_activity_info,
    "dragon.assign.player.info": sanitize_dragon_assign_player_info,
    "dragon.battle.history": sanitize_dragon_battle_history,
    "chat.get.system.mails": sanitize_chat_get_system_mails,
    "rank.get.by.range": sanitize_rank_get_by_range,
    "get.fight.report.detail": sanitize_get_fight_report_detail,
    "mail.read.share": sanitize_mail_read_share,
    "kill.rank": sanitize_kill_rank,
    "al.battle.rank.info": sanitize_al_battle_rank_info,
    "get.daily.alliance.donate.rank": sanitize_alliance_donate_rank,
    "get.week.alliance.donate.rank": sanitize_alliance_donate_rank,
    "al.rank": sanitize_al_rank,
    "alliance.rank": sanitize_alliance_rank,
    "get.al.info": sanitize_get_al_info,
    "get.new.user.info": sanitize_get_new_user_info,
    "get.user.info.multi": sanitize_get_user_info_multi,
    "server.rank": sanitize_server_rank,
    "user.get.arena.info": sanitize_user_get_arena_info,
    "get.alliance.season.score.rank": sanitize_alliance_season_score_rank,
    "desert.force.server.rank": sanitize_desert_force_server_rank,
    "world.get.new": sanitize_world_get_new,
}
