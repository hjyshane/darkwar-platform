"""battle_report: a round decodes to attacker/defender and damage is the drop.

Messages are built with the wire format by hand, so the test pins the layout
documented in battle_report.py and not a captured payload.
"""

from __future__ import annotations

import base64
import json
import sqlite3
import struct
from pathlib import Path

from dw_collector.battle_report import (
    build_report,
    pairs,
    render,
    round_kind,
    server_of,
)

UUID_A = 1_420_304_657_000_000_001
UUID_B = 1_420_304_657_000_000_002


def varint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def f_int(no: int, value: int) -> bytes:
    return varint(no << 3) + varint(value)


def f_bytes(no: int, value: bytes) -> bytes:
    return varint(no << 3 | 2) + varint(len(value)) + value


def f_float(no: int, value: float) -> bytes:
    return varint(no << 3 | 5) + struct.pack("<f", value)


def unit(start: int, left: int, uuid: int, uid: str | None) -> bytes:
    body = f_int(1, start) + f_int(2, left) + f_int(3, uuid)
    if uid is not None:
        body += f_bytes(4, uid.encode())
    return body + f_float(8, 100.0)


def march(u: bytes, kind: int) -> bytes:
    return f_bytes(1, u) + f_int(2, kind)


def round_message(a: bytes, d: bytes, kind: int = 7) -> bytes:
    pair = f_bytes(1, a) + f_bytes(2, d) + f_int(3, 1000)
    return f_int(1, kind) + f_bytes(3, f_bytes(1, pair))


def b64(raw: bytes) -> str:
    return "b64:" + base64.b64encode(raw).decode()


PLAYER_A = "1135062125000580"
PLAYER_B = "1200155838000581"


def test_pair_is_found_under_nesting() -> None:
    msg = round_message(
        march(unit(1000, 900, UUID_A, PLAYER_A), 1),
        march(unit(500, 400, UUID_B, PLAYER_B), 1),
    )
    found = list(pairs(msg))
    assert len(found) == 1
    attacker, defender = found[0]
    assert attacker.uid == PLAYER_A and attacker.left == 900
    assert defender.uid == PLAYER_B and defender.march == UUID_B
    assert round_kind(msg) == 7


def test_a_monster_has_no_uid_and_is_keyed_by_kind(tmp_path: Path) -> None:
    db = tmp_path / "j.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "create table raw_observations (observation_id text primary key, collector_id text,"
        " source_command text, captured_at text, collected_from_server_id integer,"
        " payload_json text, created_at text)"
    )
    rounds = [
        round_message(
            march(unit(1000, left, UUID_A, PLAYER_A), 1),
            march(unit(5000, boss, UUID_B, None), 38),
            kind=38,
        )
        for left, boss in ((1000, 5000), (900, 4000), (900, 3500), (800, 3500))
    ]
    payload = {"reports": [{"contentBytes": b64(r)} for r in rounds]}
    # The same payload twice: a report seen in both batch and group counts once.
    for n, cmd in enumerate(("push.battle.round.batch", "push.battle.round.group")):
        conn.execute(
            "insert into raw_observations values (?,?,?,?,?,?,?)",
            (str(n), "c", cmd, "2026-10-02T01:00:00+00:00", 580, json.dumps(payload), "x"),
        )
    board = {"rankList": [{"uid": PLAYER_A, "name": "Duck", "abbr": "CBFW"}]}
    conn.execute(
        "insert into raw_observations values (?,?,?,?,?,?,?)",
        (
            "9",
            "c",
            "get.server.duel.kill.rank.info",
            "2026-10-02T05:00:00+00:00",
            580,
            json.dumps(board),
            "x",
        ),
    )
    conn.commit()
    conn.close()

    report = build_report(db, "2026-10-02T00:00:00+00:00", "2026-10-02T02:00:00+00:00")

    assert report.reports_seen == 4
    duck = report.entities[PLAYER_A]
    boss = report.entities["npc:38"]
    assert (duck.name, duck.abbr, duck.server) == ("Duck", "CBFW", 580)
    assert duck.dealt == 1500 and duck.taken == 200  # boss 5000->3500, player 1000->800
    assert boss.taken == 1500 and boss.dealt == 200
    assert duck.pvp_dealt == 0 and duck.pvp_taken == 0  # monster only
    assert "Duck" in render(report, label="Frankie")


def test_server_is_the_trailing_six_digits() -> None:
    assert server_of(PLAYER_A) == 580
    assert server_of("12") is None
