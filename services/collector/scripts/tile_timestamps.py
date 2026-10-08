"""Which map-tile fields look like timestamps? — hunting the shield timer.

`protocol/worldmap.py` interprets four things on a tile (coordinate, type, the
city's uid / HQ level / name). Everything else stays raw, and nothing says
where a shield's end time lives. This lists every protobuf field of every tile
in the committed `world.get.new` fixtures, per object type, and flags the ones
whose values sit near the viewport's own `timeStamp` — as epoch seconds or
milliseconds, within 90 days before and 180 days after it.

Then, for type-3 city tiles, it checks the pair that stood out when this was
first run (docs/vantera-research.md): `f3.8` and `f3.9`. THEY ARE NOT THE
SHIELD. The shield end is `f3.11` (confirmed 2026-10-08 against a screen
reading, see `protocol/worldmap.py`); the committed fixtures predate that
capture and carry too few shielded cities to show it, so f3.11 is only
summarised here.

It READS the fixtures and WRITES nothing. Run from anywhere:

    uv run python services/collector/scripts/tile_timestamps.py

A candidate is not a verdict. The ground truth is a tile whose owner's shield
you read off the game screen yourself.
"""

from __future__ import annotations

import base64
import collections
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dw_collector.protocol.worldmap import _fields

ROOT = Path(__file__).resolve().parents[3]

FIXTURES = ROOT / "protocol-fixtures" / "decoded" / "world.get.new"
NAMES = ("season3_viewport_v1.json", "season3_buildings_v1.json")
BEFORE = 90 * 86400
AFTER = 180 * 86400
CITY = 3
CITY_FIELD = 3


def tiles() -> tuple[int, list[bytes]]:
    now = 0
    raws: list[bytes] = []
    for name in NAMES:
        doc = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
        payloads = doc["payload"] if isinstance(doc["payload"], list) else [doc["payload"]]
        for payload in payloads:
            now = now or payload["timeStamp"] // 1000
            for point in payload["points"]:
                body = point.removeprefix("b64:")
                raws.append(base64.b64decode(body + "=" * (-len(body) % 4), altchars=b"-_"))
    return now, raws


def walk(
    buf: bytes, path: tuple[int, ...], into: dict[tuple[int, ...], list[Any]], depth: int = 0
) -> None:
    try:
        fields = _fields(buf)
    except Exception:  # bytes that are not a message are just bytes
        return
    for number, values in fields.items():
        for value in values:
            into[(*path, number)].append(value)
            if isinstance(value, bytes) and depth < 2:
                walk(value, (*path, number), into, depth + 1)


def epoch_like(values: list[int], now: int) -> str:
    low, high = min(values), max(values)
    for scale, label in ((1, "sec"), (1000, "ms")):
        if now - BEFORE <= low / scale and high / scale <= now + AFTER:
            return f"  <<< epoch-{label}-like"
    return ""


def main() -> int:
    now, raws = tiles()
    by_type: dict[Any, dict[tuple[int, ...], list[Any]]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )
    cities: list[dict[int, int]] = []
    for raw in raws:
        top = _fields(raw)
        kind = top.get(2, [None])[0]
        walk(raw, (), by_type[kind])
        if kind == CITY and isinstance(top.get(CITY_FIELD, [None])[0], bytes):
            inner = _fields(top[CITY_FIELD][0])
            cities.append({k: v[0] for k, v in inner.items() if isinstance(v[0], int)})

    print(f"viewport timeStamp {now}  tiles {len(raws)}")
    for kind, fields in sorted(by_type.items(), key=lambda item: str(item[0])):
        print(f"\n== object type {kind}")
        for path, values in sorted(fields.items()):
            ints = [v for v in values if isinstance(v, int)]
            label = ".".join(map(str, path))
            if ints:
                flag = epoch_like(ints, now)
                print(
                    f"  {label:10} n={len(ints):5} distinct={len(set(ints)):5}"
                    f" min={min(ints)} max={max(ints)}{flag}"
                )
            else:
                print(f"  {label:10} n={len(values):5} bytes")

    ends = [c for c in cities if 8 in c]
    both = [c for c in cities if 8 in c and 9 in c]
    print(f"\ncities {len(cities)}; with f3.8: {len(ends)}; with f3.8 and f3.9: {len(both)}")
    print(f"  f3.8 always after now: {all(c[8] > now for c in ends)}")
    print(f"  f3.9 always before now: {all(c[9] <= now for c in both)}")
    spans = sorted(round((c[8] - c[9]) / 3600, 1) for c in both)
    print(f"  (f3.8 - f3.9) in hours, round numbers would mean a fixed-length shield: {spans}")
    ends11 = [c[11] for c in cities if 11 in c]
    print(
        f"\nf3.11 (shield end): on {len(ends11)} of {len(cities)} cities, "
        f"in the future on {sum(v > now for v in ends11)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
