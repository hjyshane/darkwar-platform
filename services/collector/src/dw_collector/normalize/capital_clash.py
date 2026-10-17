"""Capital Clash: the score board and the relocations (0287).

Two commands, one event. Together they are what "took part" is judged on.

``get.kingdom.act.score.rank`` -> ``capital_clash_scores``
    The event's personal ranking: ``rankList`` [{uid, name, abbr, score, rank,
    power, ...}], plus ``selfRank`` / ``selfScore`` for the collector's own
    account. Read on 2026-10-17 (battle 14:00-15:20 UTC): four distinct reads at
    14:05, 14:29, 14:34 and 15:03 UTC, 86 to 100 rows each, five alliances on
    one board. **It is the top 100 of the whole server group, not our
    alliance's members**: a member under the cutoff (about 2.7M that night) is
    not on it, so absence from this board says nothing about anybody. A score
    only grows inside an event, so the report takes the highest per member.
    The final board was not read (the last read was 17 minutes before the end).

``push.world.point.update`` (type ``relocate``) -> ``player_relocations``
    A player's city moved. ``points`` holds base64 protobuf messages; the
    outer ``1`` is the destination point id and ``3`` the player:
    ``1`` uid, ``7`` alliance id, ``14`` name, ``15`` alliance abbreviation.
    Every other ``type`` of this command (change, remove, foldUp, create) is a
    map tile redrawn, not a move, and writes nothing. 36 relocations were
    seen on 2026-10-17, and every one made during the battle landed in one
    block of the map: that block is the capital, decided in SQL from the point
    id (0287), not here. The point id is kept as the game sent it.

Only the pushes that reach the collector's account are seen, so this list is a
floor too.
"""

from __future__ import annotations

import base64
from datetime import UTC, date, datetime, timedelta
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

_UID_SERVER_SUFFIX = 6
# The game day turns over at 02:00 UTC (midnight server time, UTC-2).
_DAY_TURNS = timedelta(hours=2)
_B64 = "b64:"


def _game_day(captured_at: datetime) -> date:
    return (captured_at.astimezone(UTC) - _DAY_TURNS).date()


def _server_of(uid: str, fallback: int) -> int:
    return int(uid[-_UID_SERVER_SUFFIX:]) if len(uid) > _UID_SERVER_SUFFIX else fallback


def _numeric_uid(value: str) -> str:
    if not value.isdigit():
        msg = f"uid must be a numeric string, got {value!r}"
        raise ValueError(msg)
    return value


# --- the score board ------------------------------------------------------


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    abbr: str | None = None
    score: int = Field(ge=0)
    rank: int | None = Field(default=None, gt=0)
    power: int | None = Field(default=None, ge=0)

    _uid = field_validator("uid")(staticmethod(_numeric_uid))


class _Board(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(default_factory=list, alias="rankList")


@register("get.kingdom.act.score.rank")
def normalize_scores(observation: Observation) -> list[NormalizedRow]:
    board = _Board.model_validate(observation.payload)
    raw_entries: list[dict[str, Any]] = observation.payload.get("rankList") or []
    held_on = _game_day(observation.captured_at)

    rows: list[NormalizedRow] = []
    for entry, raw_entry in zip(board.entries, raw_entries, strict=True):
        game_uid = int(entry.uid)
        server_id = _server_of(entry.uid, observation.collected_from_server_id)
        key = entry_idempotency_key(
            observation, f"capital_clash:{game_uid}", held_on.isoformat(), raw_entry
        )
        rows.append(
            NormalizedRow(
                target_table="capital_clash_scores",
                idempotency_key=key,
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_entry,
                    "snapshot_id": str(stable_uuid(key)),
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "held_on": held_on.isoformat(),
                    "alliance_code": entry.abbr,
                    "rank": entry.rank,
                    "score": entry.score,
                },
                entity_refs={
                    "player": {"game_uid": game_uid, "server_id": server_id, "name": entry.name}
                },
            )
        )
    return rows


# --- relocations ----------------------------------------------------------


def _varint(data: bytes, pos: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        if pos >= len(data):
            msg = "truncated varint"
            raise ValueError(msg)
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, pos
        shift += 7


def _message(data: bytes) -> dict[int, list[int | bytes]]:
    """Protobuf wire format into {field number: [values]}: varints as ints,
    length-delimited and fixed-width fields as bytes. Nothing is named here;
    the caller knows which numbers it wants."""
    fields: dict[int, list[int | bytes]] = {}
    pos = 0
    while pos < len(data):
        tag, pos = _varint(data, pos)
        number, wire = tag >> 3, tag & 7
        value: int | bytes
        if wire == 0:
            value, pos = _varint(data, pos)
        elif wire == 2:
            length, pos = _varint(data, pos)
            if pos + length > len(data):
                msg = "length-delimited field runs past the message"
                raise ValueError(msg)
            value = data[pos : pos + length]
            pos += length
        elif wire == 1:
            value, pos = data[pos : pos + 8], pos + 8
        elif wire == 5:
            value, pos = data[pos : pos + 4], pos + 4
        else:
            msg = f"unsupported wire type {wire}"
            raise ValueError(msg)
        fields.setdefault(number, []).append(value)
    return fields


def _text(fields: dict[int, list[int | bytes]], number: int) -> str | None:
    values = fields.get(number)
    if not values or not isinstance(values[0], bytes):
        return None
    return values[0].decode("utf-8", errors="replace") or None


class _Relocation(BaseModel):
    point_id: int
    uid: str
    name: str | None
    alliance_code: str | None
    alliance_external_id: str | None

    _uid = field_validator("uid")(staticmethod(_numeric_uid))


def _as_b64(encoded: str | bytes) -> str:
    """The `b64:` text a point is stored as. Read from the journal a point is
    already that text; straight off the wire it is the raw message as bytes.
    Both must key and store identically or a replay duplicates history."""
    if isinstance(encoded, bytes):
        return _B64 + base64.b64encode(encoded).decode("ascii")
    if not encoded.startswith(_B64):
        msg = "a relocated point is a protobuf message (bytes or b64: text)"
        raise ValueError(msg)
    return encoded


def _decode_relocation(encoded: str) -> _Relocation:
    outer = _message(base64.b64decode(encoded[len(_B64) :]))
    point_ids = outer.get(1)
    players = outer.get(3)
    if not point_ids or not isinstance(point_ids[0], int):
        msg = "relocated point has no destination point id"
        raise ValueError(msg)
    if not players or not isinstance(players[0], bytes):
        msg = "relocated point has no player"
        raise ValueError(msg)
    player = _message(players[0])
    return _Relocation(
        point_id=point_ids[0],
        uid=_text(player, 1) or "",
        name=_text(player, 14),
        alliance_code=_text(player, 15),
        alliance_external_id=_text(player, 7),
    )


@register("push.world.point.update")
def normalize_relocations(observation: Observation) -> list[NormalizedRow]:
    if observation.payload.get("type") != "relocate":
        return []
    rows: list[NormalizedRow] = []
    for point in observation.payload.get("points") or []:
        encoded = _as_b64(point)
        move = _decode_relocation(encoded)
        game_uid = int(move.uid)
        server_id = _server_of(move.uid, observation.collected_from_server_id)
        key = entry_idempotency_key(
            observation,
            f"relocate:{game_uid}:{move.point_id}",
            observation.captured_at.isoformat(),
            {"point": encoded},
        )
        # No alliance ref: the message names the alliance by id and code only,
        # and an alliance row with no name is worse than none.
        entity_refs: dict[str, dict[str, Any]] = {
            "player": {"game_uid": game_uid, "server_id": server_id, "name": move.name}
        }
        rows.append(
            NormalizedRow(
                target_table="player_relocations",
                idempotency_key=key,
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": {"point": encoded},
                    "snapshot_id": str(stable_uuid(key)),
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "point_id": move.point_id,
                    "alliance_code": move.alliance_code,
                    "alliance_external_id": move.alliance_external_id,
                },
                entity_refs=entity_refs,
            )
        )
    return rows
