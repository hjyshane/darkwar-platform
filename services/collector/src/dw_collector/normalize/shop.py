"""exchange.info → shop_pack_snapshots; user.get.shop.info → shop_listing_snapshots (0215).

THE PACKS. `exchange.info` lists every pack the server offers the account
(441 on 2026-09-27): `dollar` the price, `gold_doller` the rubies included,
`item` the contents as "id;qty|id;qty", `resource` resources the same way
(resource 15 is Ruby), `percent` the game's own value claim, `start`/`end` the
window in epoch ms. `reward` is the same id for every pack and says nothing.

THE SHOPS. `user.get.shop.info` answers for one shop type at a time
(`type`): each `shopInfo` entry is an item (`goods`, `goods_num`) at a price
(`currency_num`) in a currency (`currency` "kind;id": "1;15" is resource 15,
Ruby; "2;252039" is item 252039). Types 1-3 are the Ruby shops; 2 and 3 carry
a `discount`. An entry selling a resource has `resource` instead of `goods`.

Per-account fields — bought, buy counts, choices made — are stripped before
the key is taken, so a pack bought after the first read is not a new pack.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.1.0"
RUBY_RESOURCE = "15"
_ACCOUNT_FIELDS = frozenset({"bought", "buys", "buy_times", "chooseRecord"})


def _pairs(spec: Any) -> list[tuple[str, float]]:
    """ "230110;10|210872;50" → [("230110", 10.0), ("210872", 50.0)]. Malformed
    parts are skipped rather than guessed at."""
    out: list[tuple[str, float]] = []
    if not isinstance(spec, str):
        return out
    for part in spec.split("|"):
        fields = part.split(";")
        if len(fields) < 2 or not fields[0].strip().isdigit():
            continue
        try:
            out.append((fields[0].strip(), float(fields[1])))
        except ValueError:
            continue
    return out


def _qty(value: float) -> int | float:
    return int(value) if value == int(value) else value


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _ms(value: Any) -> str | None:
    """Epoch ms as ISO. Standing packs end centuries out — past what the
    platform's fromtimestamp accepts on Windows — so the date is built by
    addition, and an end past year 9999 reads as no end."""
    if not isinstance(value, int | float) or value <= 0:
        return None
    try:
        return (_EPOCH + timedelta(milliseconds=value)).isoformat()
    except OverflowError:
        return None


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _base(observation: Observation, raw: dict[str, Any], key: str) -> dict[str, Any]:
    return {
        "observation_id": str(observation.observation_id),
        "source_command": observation.source_command,
        "parser_version": PARSER_VERSION,
        "captured_at": observation.captured_at.isoformat(),
        "collector_id": str(observation.collector_id),
        "collected_from_server_id": observation.collected_from_server_id,
        "raw": raw,
        "snapshot_id": str(stable_uuid(key)),
        "server_id": observation.collected_from_server_id,
    }


@register("exchange.info")
def normalize_packs(observation: Observation) -> list[NormalizedRow]:
    packs = observation.payload.get("exchange")
    if not isinstance(packs, list):
        return []
    rows: list[NormalizedRow] = []
    for pack in packs:
        if not isinstance(pack, dict) or not str(pack.get("id", "")).isdigit():
            continue
        dollars = _number(pack.get("dollar"))
        if dollars is None:
            continue
        clean = {k: v for k, v in pack.items() if k not in _ACCOUNT_FIELDS}
        pack_id = str(pack["id"])
        rubies = _number(pack.get("gold_doller")) or 0.0
        rubies += sum(q for rid, q in _pairs(pack.get("resource")) if rid == RUBY_RESOURCE)
        key = entry_idempotency_key(observation, f"pack:{pack_id}", "", clean)
        percent = _number(pack.get("percent"))
        rows.append(
            NormalizedRow(
                target_table="shop_pack_snapshots",
                idempotency_key=key,
                row={
                    **_base(observation, clean, key),
                    "pack_id": pack_id,
                    "name_key": str(pack["name"]) if str(pack.get("name", "")).isdigit() else None,
                    "pack_type": str(pack["type"]) if pack.get("type") not in (None, "") else None,
                    "dollars": dollars,
                    "rubies": int(rubies),
                    "claimed_percent": None if percent is None else int(percent),
                    "items": [
                        {"id": item_id, "qty": _qty(qty)}
                        for item_id, qty in _pairs(pack.get("item"))
                    ],
                    "starts_at": _ms(pack.get("start")),
                    "ends_at": _ms(pack.get("end")),
                },
            )
        )
    if rows:
        rows.append(_catalog_row(observation, [r.row["pack_id"] for r in rows]))
    return rows


def _catalog_row(observation: Observation, pack_ids: list[str]) -> NormalizedRow:
    """Which packs this capture listed (0235). A pack row is keyed by its
    content, so an unchanged pack is never written again and its captured_at
    stays where it was first seen; only this row says what the server offers
    NOW. Every exchange.info capture is the account's whole catalog (381 of
    381 entries inside their start-end window on 2026-10-05). One row per
    capture: the key carries the capture time."""
    ids = sorted(set(pack_ids), key=lambda p: (len(p), p))
    key = entry_idempotency_key(
        observation, "pack-catalog", observation.captured_at.isoformat(), {"ids": ids}
    )
    base = _base(observation, {}, key)
    return NormalizedRow(
        target_table="shop_pack_catalogs",
        idempotency_key=key,
        row={**base, "pack_ids": ids},
    )


@register("user.get.shop.info")
def normalize_listings(observation: Observation) -> list[NormalizedRow]:
    shop_type = observation.payload.get("type")
    entries = observation.payload.get("shopInfo")
    if not isinstance(shop_type, int) or not isinstance(entries, list):
        return []
    rows: list[NormalizedRow] = []
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("id") is None:
            continue
        price = entry.get("currency_num")
        if not isinstance(price, int):
            continue
        kind, _, currency_id = str(entry.get("currency", "")).partition(";")
        goods = entry.get("goods")
        listing_id = str(entry["id"])
        key = entry_idempotency_key(observation, f"listing:{shop_type}:{listing_id}", "", entry)
        rows.append(
            NormalizedRow(
                target_table="shop_listing_snapshots",
                idempotency_key=key,
                row={
                    **_base(observation, entry, key),
                    "shop_type": shop_type,
                    "listing_id": listing_id,
                    "item_id": str(goods) if str(goods or "").isdigit() else None,
                    "qty": entry.get("goods_num") if isinstance(entry.get("goods_num"), int) else 1,
                    "currency_kind": int(kind) if kind.isdigit() else None,
                    "currency_id": currency_id or None,
                    "price": price,
                    "discount": _number(entry.get("discount")),
                },
            )
        )
    return rows
