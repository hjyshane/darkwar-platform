"""The state-migration offer: per-server quotas and power floors -> migration_server_snapshots.

The Migration screen asks the server for the list with `get.migrate.servers`
(MigrateDataManager.GetMigrateRequest, found in lua_scripts_datacenter_m of
the install pack). Each entry is read by MigrateServerData.ParseServerData; the
names below are the ones that function reads off the message:

  serverId, season, season_group, server_rank_type   which server, and its type
  migrateLeft                                         seats left per level
  specialLeft, inviteLeft                             special and invite seats left
  powerLowLimit                                       the power floor per level
  powerLimit, specialPowerLimit                       the president's ceilings
  totalCount, useCount                                intake allowed / used
  targetPowerLimit, maxPower, needItemId, needItemNum, targetOpenTime, king*

NOT VERIFIED AGAINST A LIVE RESPONSE. The tab was not live when this was
written (`immigration_new` = 0 in `init`), so the envelope around the entries
and the shape of each field are inferred from that Lua, and the fixture is
hand-written from the same inference. The parser is therefore forgiving about
shape and loses nothing: the whole entry goes to `raw`, and a typed column is
null rather than guessed when its field is not what we expected. The first real
capture decides which of those guesses were right; fix the parser and add the
real response as a fixture then (see docs/runbooks/server-migration.md).

`server_id` is the OFFERING server (the one a mover would go to), not the
server the capture was made from; that is `collected_from_server_id`.

One row per server per distinct state: the key hashes the server's raw entry
and the hour, so opening the screen twice is one row and a seat count that
moves is a new one.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"
COMMAND = "get.migrate.servers"

# How deep to look for the list of servers. The envelope is unknown; the entries
# are recognisable by carrying a `serverId`.
_SEARCH_DEPTH = 3


def as_int(value: Any) -> int | None:
    """An integer, from an int or a string of digits. Never a bool, never a guess."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def int_list(value: Any) -> list[int] | None:
    """`[a, b]`, `"a;b"` or `"a,b"` as a list of ints; null if any element is not one."""
    if isinstance(value, str):
        parts: list[Any] = [p for p in value.replace(",", ";").split(";") if p.strip()]
    elif isinstance(value, list):
        parts = list(value)
    else:
        return None
    out = [as_int(p) for p in parts]
    return None if any(n is None for n in out) else [n for n in out if n is not None]


def seats(value: Any) -> Any:
    """Seats left, kept in the shape the game sent but made JSON-stable.

    The Lua walks `{type, num}` pairs, so a list of those becomes `{type: num}`.
    A dict of counts is kept; a bare number is kept as a number. Anything else is
    null here and still present whole in `raw`.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, dict):
        counts = {str(k): as_int(v) for k, v in value.items()}
        return None if any(v is None for v in counts.values()) else counts
    if isinstance(value, list):
        counts = {}
        for item in value:
            if not isinstance(item, dict):
                return None
            kind, num = as_int(item.get("type")), as_int(item.get("num"))
            if kind is None or num is None:
                return None
            counts[str(kind)] = num
        return counts
    return None


def _at(ms: Any) -> str | None:
    n = as_int(ms)
    if n is None or n <= 0:
        return None
    return datetime.fromtimestamp(n / 1000, tz=UTC).isoformat()


def entries(payload: Any, depth: int = 0) -> list[dict[str, Any]]:
    """Every server entry in the response, wherever the envelope put them."""
    if isinstance(payload, dict):
        if as_int(payload.get("serverId")) is not None:
            return [payload]
        if depth >= _SEARCH_DEPTH:
            return []
        found: list[dict[str, Any]] = []
        for value in payload.values():
            found.extend(entries(value, depth + 1))
        return found
    if isinstance(payload, list):
        found = []
        for item in payload:
            found.extend(entries(item, depth + 1))
        return found
    return []


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value != "" else None


def _uid(value: Any) -> str | None:
    """A player uid as text, whether the game sent it as a string or a number.
    Zero is how the game says "nobody"."""
    n = as_int(value)
    if n is None:
        return _text(value)
    return None if n == 0 else str(n)


def server_row(observation: Observation, entry: dict[str, Any]) -> NormalizedRow:
    captured = observation.captured_at
    server_id = as_int(entry["serverId"])
    key = entry_idempotency_key(
        observation,
        f"migrate_server:{server_id}",
        captured.strftime("%Y-%m-%dT%H"),
        entry,
        key_command=COMMAND,
    )
    return NormalizedRow(
        target_table="migration_server_snapshots",
        idempotency_key=key,
        row={
            "observation_id": str(observation.observation_id),
            "source_command": observation.source_command,
            "parser_version": PARSER_VERSION,
            "captured_at": captured.isoformat(),
            "collector_id": str(observation.collector_id),
            "collected_from_server_id": observation.collected_from_server_id,
            "raw": entry,
            "snapshot_id": str(stable_uuid(key)),
            "server_id": server_id,
            "season": as_int(entry.get("season")),
            "season_group": as_int(entry.get("season_group")),
            "server_rank_type": as_int(entry.get("server_rank_type")),
            "total_count": as_int(entry.get("totalCount")),
            "use_count": as_int(entry.get("useCount")),
            "migrate_left": seats(entry.get("migrateLeft")),
            "special_left": seats(entry.get("specialLeft")),
            "invite_left": seats(entry.get("inviteLeft")),
            "power_low_limit": int_list(entry.get("powerLowLimit")),
            "power_limit": as_int(entry.get("powerLimit")),
            "special_power_limit": as_int(entry.get("specialPowerLimit")),
            "target_power_limit": as_int(entry.get("targetPowerLimit")),
            "max_power": as_int(entry.get("maxPower")),
            "need_item_id": as_int(entry.get("needItemId")),
            "need_item_num": as_int(entry.get("needItemNum")),
            "target_open_at": _at(entry.get("targetOpenTime")),
            "king_name": _text(entry.get("kingName")),
            "king_uid": _uid(entry.get("kingUid")),
        },
    )


@register(COMMAND)
def normalize_servers(observation: Observation) -> list[NormalizedRow]:
    return [server_row(observation, entry) for entry in entries(observation.payload)]
