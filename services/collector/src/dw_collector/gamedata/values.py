"""What an item is worth, in rubies, for the pack report (0215).

GAME. The client's `goods.price` is each item's ruby price, and it equals the
Ruby shop's list price for every item that shop sells (checked against
`user.get.shop.info` type 1 on 2026-10-03: teleporters, recruitment tickets,
skill books). 174 items carry one.

VIP POINTS ARE 0 by the user's decision (2026-10-03): a bonus, not value. The
game prices them, and they are in almost every pack, so counting them would
lift every pack alike and hide the differences the report exists to show.

ESTIMATED. Items the Ruby shop never sells — Power Core, Precision Part,
Design Blueprint — get a value back-solved from the packs they appear in. Each
pack claims a value (`percent` of its price); hold the game-priced items at
their price, and the rest is a non-negative least-squares problem in the
unknown items, weighted so every pack counts by its relative error. The fit is
loose (median 4%, some items barely constrained), which is why these are
marked estimated and an officer's value always wins.

1 RUBY = $0.0099: every ruby-only pack is 100 rubies per $0.99.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from dw_collector.gamedata.luatable import decode
from dw_collector.gamedata.names import datatable_bytes, localisation

DOLLARS_PER_RUBY = 0.99 / 100
# An estimate needs the item in packs of at least this many different
# compositions. Five copies of one pack (Wartime Investment, 2026-10-03) say
# no more than one: the item unique to them takes the whole of their claim —
# Land Expansion came out at 7,625 rubies from an 8000% claim. Left unvalued,
# the pack shows the gap instead of a ratio built on it.
MIN_COMPOSITIONS = 2
_SWEEPS = 3000


@dataclass(frozen=True)
class Pack:
    dollars: float
    rubies: float
    claimed_percent: float
    items: tuple[tuple[str, float], ...]


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def game_prices(assets: Mapping[str, bytes], *, vip_as_zero: bool = True) -> dict[str, float]:
    """item id → rubies from goods.price, VIP Points forced to 0 for the
    report. The estimate needs them at the game's price instead: the game's
    value claims count them, and zeroing them there would hand their share to
    whatever else is in the pack."""
    strings = localisation(assets)
    goods = decode(datatable_bytes(assets, "goods"), "goods")
    out: dict[str, float] = {}
    for item_id, row in goods.rows.items():
        if not item_id.isdigit():
            continue
        name = strings.get(str(row.get("name", "")).strip(), "")
        if vip_as_zero and "VIP Points" in name:
            out[item_id] = 0.0
            continue
        price = _number(row.get("price"))
        if price > 0:
            out[item_id] = price
    return out


def _nnls(columns: list[dict[int, float]], targets: list[float]) -> list[float]:
    """min ||Ax - b||, x >= 0, by coordinate descent. A is given column by
    column as {row: value}; small and sparse here (~240 x ~80)."""
    x = [0.0] * len(columns)
    residual = list(targets)  # b - Ax, with x = 0
    norms = [sum(v * v for v in col.values()) for col in columns]
    for _ in range(_SWEEPS):
        moved = 0.0
        for j, col in enumerate(columns):
            if norms[j] == 0:
                continue
            step = sum(v * residual[i] for i, v in col.items()) / norms[j]
            new = max(0.0, x[j] + step)
            delta = new - x[j]
            if delta:
                for i, v in col.items():
                    residual[i] -= v * delta
                x[j] = new
                moved = max(moved, abs(delta))
        if moved < 1e-6:
            break
    return x


def estimate(packs: Iterable[Pack], known: Mapping[str, float]) -> dict[str, float]:
    """Rubies per unit for items `known` does not price, from the packs'
    claimed values. Items seen in fewer than MIN_COMPOSITIONS different pack
    compositions are left out."""
    rows: list[dict[str, float]] = []
    shapes: list[frozenset[tuple[str, float]]] = []
    targets: list[float] = []
    for pack in packs:
        if pack.dollars <= 0 or pack.claimed_percent <= 0 or not pack.items:
            continue
        claimed = pack.claimed_percent / 100 * pack.dollars / DOLLARS_PER_RUBY
        remaining = claimed - pack.rubies
        unknown: dict[str, float] = {}
        for item_id, qty in pack.items:
            if item_id in known:
                remaining -= known[item_id] * qty
            else:
                unknown[item_id] = unknown.get(item_id, 0.0) + qty
        if not unknown:
            continue
        # Relative error: a $99 pack and a $0.99 pack count alike.
        rows.append({item_id: qty / claimed for item_id, qty in unknown.items()})
        # Items and quantities: the same items in other amounts is a second,
        # independent claim; an identical copy is not.
        shapes.append(frozenset(pack.items))
        targets.append(remaining / claimed)
    # Fixed point. A pack is usable only if every unknown in it can be
    # estimated: an item it alone holds would otherwise hand its share of the
    # claim to the others. And an item is estimable only if usable packs
    # show it in two different compositions — compared on what is being
    # solved, so variants that differ only in an unusable item are copies.
    # Wartime Investment's five variants each add one item no other pack has;
    # without this, Land Expansion took the whole 8000% claim (2026-10-03).
    candidates = {item_id for row in rows for item_id in row}
    while True:
        usable = [i for i, row in enumerate(rows) if set(row) <= candidates]
        compositions: dict[str, set[frozenset[tuple[str, float]]]] = {}
        for i in usable:
            shape = frozenset(
                (item_id, qty)
                for item_id, qty in shapes[i]
                if item_id in candidates or item_id in known
            )
            for item_id in rows[i]:
                compositions.setdefault(item_id, set()).add(shape)
        narrowed = {
            item_id for item_id, seen in compositions.items() if len(seen) >= MIN_COMPOSITIONS
        }
        if narrowed == candidates:
            break
        candidates = narrowed
    items = sorted(candidates)
    index = {item_id: j for j, item_id in enumerate(items)}
    columns: list[dict[int, float]] = [{} for _ in items]
    kept: list[float] = []
    for row_number, i in enumerate(usable):
        for item_id, value in rows[i].items():
            columns[index[item_id]][row_number] = value
        kept.append(targets[i])
    solved = _nnls(columns, kept)
    return {item_id: round(solved[j], 2) for item_id, j in index.items()}


def pack_from_row(row: Mapping[str, Any]) -> Pack:
    """A shop_pack_snapshots row as fetched from PostgREST."""
    return Pack(
        dollars=_number(row.get("dollars")),
        rubies=_number(row.get("rubies")),
        claimed_percent=_number(row.get("claimed_percent")),
        items=tuple(
            (str(item["id"]), _number(item.get("qty")))
            for item in row.get("items") or []
            if isinstance(item, dict) and str(item.get("id", "")).isdigit()
        ),
    )


def pack_names(assets: Mapping[str, bytes], keys: Iterable[str]) -> list[dict[str, str | None]]:
    """game_strings rows for the pack name keys, English and Korean."""
    english = localisation(assets)
    korean = localisation(assets, "Korean")
    return [
        {"string_key": key, "en": english.get(key), "ko": korean.get(key)}
        for key in sorted(set(keys))
        if key.isdigit() and (key in english or key in korean)
    ]
