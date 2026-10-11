"""A battle report for any time window: who hit whom, and for how much.

Asked for on 2026-10-11, after the 10-10 server clash: the round-by-round
battle stream was decoded once by hand, and the user wanted the same table for
every clash and event (Capital Clash, Server Clash, Frankie, Black Gold, season
events) without redoing the work.

WHAT THE STREAM IS. `push.battle.round.batch` and `push.battle.round.group`
carry every fight the client could see, one protobuf per round. There is no
`.proto`; the layout below was read off 21,009 PvP rounds and 30,000 monster
rounds and checked by one invariant: a march's remaining troops only ever go
down, and one side's drop equals the other side's `taken`.

    unit    {1: troops at the start, 2: troops left now, 3: march uuid,
             4: player uid (a string, ABSENT for a monster), 8: float}
    march   {1: unit, 2: kind, 3: march uuid, 4: coordinate y*1000+x}
    pair    {1: march, 2: march, ...} -- attacker and defender of one round

`kind` is 1 for a player and a monster id otherwise (4, 6, 38, 41 seen on
Frankie day), so one decoder serves Capital Clash, Server Clash, Frankie and
the rest: a PvP round and a monster round differ only in whether the unit
carries a uid. The round's own type (field 1: 7 PvP, 6/38/4/41 monster) is
kept but not needed.

DAMAGE is the drop of a march's `left` between two sightings, credited to the
opposing side of the pair it was seen in. It is troops, not kills, and it is
NOT the event's own score: the kill board counts something else. Report both.

COVERAGE is what the collector's client saw. The collector account appears in
far more rounds than anyone else, so its own damage reads high; an alliance or
server total is the sounder number. Players on no board have no name.

READ ONLY. The journal is opened `mode=ro`; `raw_observations` has no index on
`source_command`, so everything (rounds and the boards names come from) is
taken in ONE pass over the file.
"""

from __future__ import annotations

import base64
import csv
import json
import sqlite3
import struct
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

ROUND_COMMANDS = ("push.battle.round.batch", "push.battle.round.group")

# Boards that carry {uid, name, abbr}. Only used to put names on uids.
NAME_COMMANDS = frozenset(
    {
        "get.server.duel.kill.rank.info",
        "server.battle.score.person.rank",
        "get.kingdom.act.score.rank",
        "al.rank",
        "alliance.rank",
        "kill.rank",
        "rank.get.by.range",
        "server.rank",
        "get.user.info.multi",
        "player.info",
    }
)

_B64_PREFIX = "b64:"
_MAX_DEPTH = 8
_UUID_FLOOR = 10**15  # march uuids are ~1.4e18; a pool or a count is far below


# --------------------------------------------------------------------------
# protobuf wire format, just enough. Returns None on anything malformed so a
# bytes field that is not a message is treated as a leaf, not an error.


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        byte = buf[i]
        i += 1
        result |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return result, i


def parse(buf: bytes) -> list[tuple[int, Any]] | None:
    """Decode one message to [(field, value)]. Nested messages stay bytes."""
    out: list[tuple[int, Any]] = []
    i = 0
    try:
        while i < len(buf):
            key, i = _varint(buf, i)
            field_no, wire = key >> 3, key & 7
            if field_no == 0:
                return None
            value: Any
            if wire == 0:
                value, i = _varint(buf, i)
            elif wire == 1:
                value = struct.unpack("<d", buf[i : i + 8])[0]
                i += 8
            elif wire == 5:
                value = struct.unpack("<f", buf[i : i + 4])[0]
                i += 4
            elif wire == 2:
                length, i = _varint(buf, i)
                chunk = buf[i : i + length]
                if len(chunk) != length:
                    return None
                value = chunk
                i += length
            else:
                return None
            out.append((field_no, value))
    except (IndexError, struct.error):
        return None
    return out


def _first(msg: list[tuple[int, Any]], number: int) -> Any:
    for f, v in msg:
        if f == number:
            return v
    return None


def _sub(msg: list[tuple[int, Any]], number: int) -> list[tuple[int, Any]] | None:
    raw = _first(msg, number)
    return parse(raw) if isinstance(raw, bytes) else None


# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Unit:
    start: int
    left: int
    march: int
    uid: str | None
    kind: int | None


def _unit(march: list[tuple[int, Any]] | None) -> Unit | None:
    if march is None:
        return None
    body = _sub(march, 1)
    if body is None:
        return None
    start, left, uuid = _first(body, 1), _first(body, 2), _first(body, 3)
    if not (isinstance(start, int) and isinstance(left, int) and isinstance(uuid, int)):
        return None
    if uuid < _UUID_FLOOR:
        return None
    raw_uid = _first(body, 4)
    uid = raw_uid.decode("ascii", "replace") if isinstance(raw_uid, bytes) else None
    kind = _first(march, 2)
    return Unit(start, left, uuid, uid, kind if isinstance(kind, int) else None)


def pairs(message: bytes, depth: int = 0) -> Iterator[tuple[Unit, Unit]]:
    """Every (attacker, defender) in one round message, wherever nested."""
    msg = parse(message)
    if msg is None or depth > _MAX_DEPTH:
        return
    a, d = _unit(_sub(msg, 1)), _unit(_sub(msg, 2))
    if a is not None and d is not None:
        yield a, d
    for _, value in msg:
        if isinstance(value, bytes) and len(value) > 8:
            yield from pairs(value, depth + 1)


def round_kind(message: bytes) -> int | None:
    msg = parse(message)
    value = _first(msg, 1) if msg else None
    return value if isinstance(value, int) else None


def iter_reports(payload: dict[str, Any]) -> Iterator[str]:
    for report in payload.get("reports") or []:
        yield report.get("contentBytes", "")
    for group in payload.get("reportGroups") or []:
        for report in group.get("reports") or []:
            yield report.get("contentBytes", "")


def server_of(uid: str) -> int | None:
    """Home server: the trailing six digits of a uid (D-1)."""
    return int(uid[-6:]) if len(uid) >= 6 and uid[-6:].isdigit() else None


@dataclass
class Entity:
    key: str
    uid: str | None
    kind: int | None
    rounds: int = 0
    dealt: int = 0
    taken: int = 0
    # The part of dealt/taken that was against another player, not a monster.
    pvp_dealt: int = 0
    pvp_taken: int = 0
    name: str = ""
    abbr: str = ""

    @property
    def server(self) -> int | None:
        return server_of(self.uid) if self.uid else None


@dataclass
class Report:
    start: str
    end: str
    reports_seen: int = 0
    rounds: int = 0
    round_kinds: Counter[int | None] = field(default_factory=Counter)
    entities: dict[str, Entity] = field(default_factory=dict)
    _left: dict[int, int] = field(default_factory=dict)

    def _entity(self, unit: Unit) -> Entity:
        key = unit.uid if unit.uid else f"npc:{unit.kind}"
        if key not in self.entities:
            self.entities[key] = Entity(key, unit.uid, unit.kind)
        return self.entities[key]

    def add_round(self, attacker: Unit, defender: Unit) -> None:
        self.rounds += 1
        sides = ((attacker, defender), (defender, attacker))
        for unit, other in sides:
            who, opp = self._entity(unit), self._entity(other)
            who.rounds += 1
            previous = self._left.get(unit.march)
            if previous is not None and unit.left < previous:
                drop = previous - unit.left
                who.taken += drop
                opp.dealt += drop
                if unit.uid and other.uid:
                    who.pvp_taken += drop
                    opp.pvp_dealt += drop
            self._left[unit.march] = unit.left if previous is None else min(previous, unit.left)


def _name_walk(node: Any, names: dict[str, tuple[str, str]]) -> None:
    if isinstance(node, dict):
        uid, name = node.get("uid"), node.get("name")
        if isinstance(uid, str) and isinstance(name, str) and uid.isdigit():
            abbr = node.get("abbr") or node.get("allianceAbbr") or ""
            names.setdefault(uid, (name, abbr if isinstance(abbr, str) else ""))
        for value in node.values():
            _name_walk(value, names)
    elif isinstance(node, list):
        for value in node:
            _name_walk(value, names)


def build_report(
    journal: Path,
    start: str,
    end: str,
    *,
    name_pad_hours: int = 36,
) -> Report:
    """One pass over the journal. start/end are ISO UTC strings."""
    pad = _shift(start, -name_pad_hours), _shift(end, name_pad_hours)
    wanted = (*ROUND_COMMANDS, *sorted(NAME_COMMANDS))
    marks = ",".join("?" for _ in wanted)
    report = Report(start=start, end=end)
    names: dict[str, tuple[str, str]] = {}
    seen: set[str] = set()
    conn = sqlite3.connect(f"file:{journal.as_posix()}?mode=ro", uri=True, timeout=60)
    try:
        cursor = conn.execute(
            "select source_command, captured_at, payload_json from raw_observations "
            f"where source_command in ({marks}) and captured_at >= ? and captured_at < ? "
            "order by captured_at",
            (*wanted, pad[0], pad[1]),
        )
        for command, captured_at, payload_json in cursor:
            try:
                payload = json.loads(payload_json)
            except json.JSONDecodeError:
                continue
            if command not in ROUND_COMMANDS:
                _name_walk(payload, names)
                continue
            if not (start <= captured_at < end):
                continue
            for content in iter_reports(payload):
                if content in seen or not content.startswith(_B64_PREFIX):
                    continue
                seen.add(content)
                report.reports_seen += 1
                try:
                    raw = base64.b64decode(content[len(_B64_PREFIX) :])
                except ValueError:
                    continue
                report.round_kinds[round_kind(raw)] += 1
                for attacker, defender in pairs(raw):
                    report.add_round(attacker, defender)
    finally:
        conn.close()
    for entity in report.entities.values():
        if entity.uid and entity.uid in names:
            entity.name, entity.abbr = names[entity.uid]
    return report


def _shift(iso: str, hours: int) -> str:
    from datetime import timedelta

    moment = datetime.fromisoformat(iso)
    return (moment + timedelta(hours=hours)).isoformat()


# --------------------------------------------------------------------------


def rows(report: Report) -> list[dict[str, Any]]:
    out = [
        {
            "who": e.key,
            "name": e.name or ("(monster)" if e.uid is None else "?"),
            "abbr": e.abbr,
            "server": e.server if e.server is not None else "",
            "rounds": e.rounds,
            "dealt": e.dealt,
            "taken": e.taken,
            "pvp_dealt": e.pvp_dealt,
            "pvp_taken": e.pvp_taken,
        }
        for e in report.entities.values()
    ]
    return sorted(out, key=lambda r: -int(r["dealt"]))


def write_csv(report: Report, path: Path) -> None:
    table = rows(report)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "who",
                "name",
                "abbr",
                "server",
                "rounds",
                "dealt",
                "taken",
                "pvp_dealt",
                "pvp_taken",
            ],
        )
        writer.writeheader()
        writer.writerows(table)


def render(report: Report, *, label: str = "", top: int = 20) -> str:
    table = rows(report)
    # [fighters, rounds, dealt, taken, pvp_dealt, pvp_taken]
    by_group: dict[tuple[Any, str], list[int]] = defaultdict(lambda: [0] * 6)
    for r in table:
        g = by_group[(r["server"], r["abbr"] or "?")]
        g[0] += 1
        for slot, key in enumerate(("rounds", "dealt", "taken", "pvp_dealt", "pvp_taken"), 1):
            g[slot] += int(r[key])
    lines = [
        f"# Battle report{' - ' + label if label else ''}",
        "",
        f"Window {report.start} to {report.end} UTC. "
        f"{report.reports_seen:,} distinct reports, {report.rounds:,} rounds, "
        f"{len(table)} fighters.",
        "",
        "Damage is the drop in a march's remaining troops, credited to the other "
        "side. PvP columns count only fights against another player; Dealt and "
        "Taken also include monsters. It is not the event's own score, and it "
        "covers only what the collector's client saw.",
        "",
        "## By server and alliance",
        "",
        "| Server | Alliance | Fighters | Rounds | PvP dealt | PvP taken | Dealt | Taken |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for (server, abbr), (n, rd, dealt, taken, pd, pt) in sorted(
        by_group.items(), key=lambda kv: -kv[1][4]
    ):
        lines.append(
            f"| {server} | {abbr} | {n} | {rd:,} | {pd:,} | {pt:,} | {dealt:,} | {taken:,} |"
        )
    lines += [
        "",
        f"## Top {top} by PvP damage dealt",
        "",
        "| Name | Server | Alliance | Rounds | PvP dealt | PvP taken | Dealt | Taken |",
        "|---|---|---|---:|---:|---:|---:|---:|",
    ]
    for r in sorted(table, key=lambda r: -int(r["pvp_dealt"]))[:top]:
        lines.append(
            f"| {r['name']} | {r['server']} | {r['abbr']} | {int(r['rounds']):,} "
            f"| {int(r['pvp_dealt']):,} | {int(r['pvp_taken']):,} "
            f"| {int(r['dealt']):,} | {int(r['taken']):,} |"
        )
    lines.append("")
    return "\n".join(lines)
