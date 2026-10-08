"""What does the CLIENT send? — the request shape behind each captured command.

Everything this collector stores is a RESPONSE (`capture/session.py` drops the
outbound direction: "our own requests are not data"). Any producer that asks
the server for something — a crawler, a lookup — has to send a request, and
nobody has written down what one carries. The decoder already reads both
directions (`iter_extension_events` yields `direction="outbound"`), so this
only has to print them.

For each command it shows the request payload's keys, their types, and how
many times each shape was seen. It also pairs each request with the response
`_id`, so you can see whether the server echoes the client's id.

SECRETS: a request carries the session signature. String values longer than
16 characters are replaced by `<str:N>`, so the output can be pasted into chat
or a doc. Short ints and strings stay visible because they are the parameters
that matter (uid lists, page numbers, server ids). Nothing is written to disk.

    uv run --no-project --python 3.12 --with "pydantic>=2" --with structlog `
      python services/collector/scripts/request_shapes.py C:/DW_data/pcaps/x.pcapng `
      --command "get.user.info.multi|get.new.user.info"

Questions this answers, in order:
  1. Which key carries the uid(s) — one id, or a list?
  2. Is the signature in every request, or only in a login frame?
  3. Is `_id` a counter the client picks?
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dw_collector.protocol.pcapng import iter_extension_events

LONG_STRING = 16
SHOW_ITEMS = 5


def describe(value: Any) -> str:
    if isinstance(value, bool) or value is None:
        return repr(value)
    if isinstance(value, int | float):
        return repr(value)
    if isinstance(value, str):
        return repr(value) if len(value) <= LONG_STRING else f"<str:{len(value)}>"
    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"
    if isinstance(value, list):
        head = ", ".join(describe(v) for v in value[:SHOW_ITEMS])
        more = f", … +{len(value) - SHOW_ITEMS}" if len(value) > SHOW_ITEMS else ""
        return f"[{head}{more}] (len {len(value)})"
    if isinstance(value, dict):
        return "{" + ", ".join(f"{k}: {describe(v)}" for k, v in value.items()) + "}"
    return f"<{type(value).__name__}>"


def shape(payload: dict[str, Any]) -> str:
    return ", ".join(f"{k}:{type(v).__name__}" for k, v in sorted(payload.items()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("pcap", type=Path)
    parser.add_argument("--command", default=".*", help="regex over the command name")
    parser.add_argument("--examples", type=int, default=2, help="requests to print per command")
    args = parser.parse_args()
    wanted = re.compile(args.command)

    shapes: dict[str, Counter[str]] = {}
    examples: dict[str, list[dict[str, Any]]] = {}
    outbound_ids: dict[int, str] = {}
    echoed = Counter[str]()

    for event in iter_extension_events(args.pcap):
        if not wanted.search(event.command):
            continue
        if event.direction == "outbound":
            shapes.setdefault(event.command, Counter())[shape(event.payload)] += 1
            bucket = examples.setdefault(event.command, [])
            if len(bucket) < args.examples:
                bucket.append(event.payload)
            if event.request_id is not None:
                outbound_ids[event.request_id] = event.command
        elif event.request_id in outbound_ids:
            echoed[event.command] += 1

    if not shapes:
        print("no outbound frames matched — was the capture filter `tcp port 8680`?")
        return 1

    for command in sorted(shapes):
        print(f"\n== {command}  ({sum(shapes[command].values())} requests)")
        for key, count in shapes[command].most_common():
            print(f"  {count:>5} x {key}")
        for payload in examples[command]:
            print(f"  e.g. {describe(payload)}")
        if echoed[command]:
            print(f"  response _id echoes a request _id: {echoed[command]} times")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
