"""train.list / get.train.info / push.world.march.new (type 15) → world_truck_snapshots.

A Dark Syndicate truck reaches us three ways and none of them is the whole truck:

* ``train.list`` is the list of trucks a player may intercept, one entry per
  truck: owner, quality, completeness, the cargo (``extraGoods.cur``), where it
  left from and when it arrives. No current position.
* ``get.train.info`` is the same entry for one truck, opened.
* ``push.world.march.new`` with ``type == 15`` is the truck as a march: the leg
  it is on (``startPos`` -> ``targetPos`` between ``startTime`` and ``endTime``)
  and the truck's own uuid in ``train.uuid``. No cargo.

They share ``train.uuid`` / ``uuid`` (the truck), so each is stored as it
arrives and ``world_trucks_latest`` (0254) joins the newest of each.

HERO FRAGMENTS. Items 210318, 210319 and 210454 (item_type 62) are the hero
fragments. Across 3,004 cargo sightings they appeared only on quality 4 and 5
trucks - 331 of them as 210454 - which is why the map's "worth taking" filter
is cargo, not quality.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

HERO_FRAGMENT_ITEM_IDS = frozenset({"210318", "210319", "210454"})
_MARCH_TYPE_TRUCK = 15
_LEG_KEYS = ("uuid", "startPos", "targetPos", "startTime", "endTime")


def _instant(ms: Any) -> str | None:
    if not isinstance(ms, int) or isinstance(ms, bool) or ms <= 0:
        return None
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat()


def _goods(entry: dict[str, Any]) -> tuple[list[dict[str, Any]] | None, int | None]:
    """The truck's cargo as ``[{id, num}]`` and how many hero fragments it holds.

    None when the entry carries no cargo at all (a march push), so the view can
    tell "no fragments" from "cargo not seen".
    """
    extra = entry.get("extraGoods")
    if not isinstance(extra, dict) or not isinstance(extra.get("cur"), list):
        return None, None
    goods: list[dict[str, Any]] = []
    fragments = 0
    for slot in extra["cur"]:
        value = slot.get("value") if isinstance(slot, dict) else None
        if not isinstance(value, dict):
            continue
        item_id, num = str(value.get("id")), value.get("num")
        if not isinstance(num, int):
            continue
        goods.append({"id": item_id, "num": num})
        if item_id in HERO_FRAGMENT_ITEM_IDS:
            fragments += num
    return goods, fragments


def _rob_times(entry: dict[str, Any]) -> int | None:
    march_info = entry.get("marchInfo")
    value = march_info.get("robTimes") if isinstance(march_info, dict) else None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _uid_text(value: Any) -> str | None:
    text = str(value) if value not in (None, "", 0) else None
    return text if text is not None and text.isdigit() else None


def _server(entry: dict[str, Any], owner: str | None) -> int | None:
    server = entry.get("serverId")
    if isinstance(server, int) and not isinstance(server, bool):
        return server
    return int(owner[-6:]) if owner is not None and len(owner) > 6 else None


def _entry_row(observation: Observation, entry: dict[str, Any]) -> NormalizedRow | None:
    """One truck from a list or an info response."""
    truck = entry.get("uuid")
    if not isinstance(truck, int) or isinstance(truck, bool):
        return None
    owner = _uid_text(entry.get("ownerId") or entry.get("uid"))
    server_id = _server(entry, owner)
    if server_id is None:
        return None
    goods, fragments = _goods(entry)
    start_pos = entry.get("startPos")
    return NormalizedRow(
        target_table="world_truck_snapshots",
        idempotency_key=entry_idempotency_key(
            observation,
            f"truck:{truck}",
            observation.captured_at.date().isoformat(),
            entry,
        ),
        row={
            **_common(observation, server_id, truck),
            "owner_game_uid": owner,
            "owner_name": entry.get("name") if isinstance(entry.get("name"), str) else None,
            "alliance_abbr": entry.get("abbr") if isinstance(entry.get("abbr"), str) else None,
            "quality": entry.get("quality") if isinstance(entry.get("quality"), int) else None,
            "cfg_id": entry.get("cfgId") if isinstance(entry.get("cfgId"), int) else None,
            "completeness": entry.get("completeness"),
            "rob_times": _rob_times(entry),
            "start_pos": start_pos if isinstance(start_pos, int) else None,
            "arrive_at": _instant(entry.get("arriveTime")),
            "send_at": _instant(entry.get("sendTime")),
            "hero_fragments": fragments,
            "goods": goods,
        },
    )


def _common(observation: Observation, server_id: int, truck: int) -> dict[str, Any]:
    return {
        "observation_id": str(observation.observation_id),
        "source_command": observation.source_command,
        "parser_version": PARSER_VERSION,
        "captured_at": observation.captured_at.isoformat(),
        "collector_id": str(observation.collector_id),
        "collected_from_server_id": observation.collected_from_server_id,
        "raw": {},
        "server_id": server_id,
        "truck_uuid": str(truck),
    }


@register("train.list")
def normalize_list(observation: Observation) -> list[NormalizedRow]:
    entries = observation.payload.get("ls")
    if not isinstance(entries, list):
        return []
    rows = [
        row
        for entry in entries
        if isinstance(entry, dict) and (row := _entry_row(observation, entry)) is not None
    ]
    return rows


@register("get.train.info")
def normalize_info(observation: Observation) -> list[NormalizedRow]:
    entry = observation.payload.get("train")
    if not isinstance(entry, dict):
        return []
    row = _entry_row(observation, entry)
    return [row] if row is not None else []


@register("push.world.march.new")
def normalize_march(observation: Observation) -> list[NormalizedRow]:
    """The truck as a march. Every other march type is somebody else's business."""
    payload = observation.payload
    train = payload.get("train")
    if payload.get("type") != _MARCH_TYPE_TRUCK or not isinstance(train, dict):
        return []
    truck = train.get("uuid")
    if not isinstance(truck, int) or isinstance(truck, bool):
        return []
    owner = _uid_text(payload.get("ownerUid") or train.get("ownerId"))
    server_id = _server(train, owner)
    if server_id is None:
        return []
    start_pos, target_pos = payload.get("startPos"), payload.get("targetPos")
    end = _instant(payload.get("endTime"))
    if not isinstance(start_pos, int) or not isinstance(target_pos, int) or end is None:
        return []
    owner_name = payload.get("ownerName")
    abbr = payload.get("allianceAbbr")
    return [
        NormalizedRow(
            target_table="world_truck_snapshots",
            idempotency_key=entry_idempotency_key(
                observation,
                f"truck-leg:{truck}",
                observation.captured_at.date().isoformat(),
                {
                    k: payload.get(k)
                    for k in ("uuid", "startPos", "targetPos", "startTime", "endTime")
                },
            ),
            row={
                **_common(observation, server_id, truck),
                "owner_game_uid": owner,
                "owner_name": owner_name if isinstance(owner_name, str) else None,
                "alliance_abbr": abbr if isinstance(abbr, str) else None,
                "quality": train.get("quality") if isinstance(train.get("quality"), int) else None,
                "cfg_id": train.get("cfgId") if isinstance(train.get("cfgId"), int) else None,
                "completeness": train.get("completeness"),
                "rob_times": _rob_times(train),
                "start_pos": start_pos,
                "target_pos": target_pos,
                "segment_start_at": _instant(payload.get("startTime")),
                "segment_end_at": end,
                "arrive_at": _instant(train.get("arriveTime")),
                "send_at": _instant(train.get("sendTime")),
                "hero_fragments": None,
                "goods": None,
            },
        )
    ]
