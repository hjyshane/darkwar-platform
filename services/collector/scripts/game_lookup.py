"""What is id N? — look an unnamed id up in the game client's own datatables.

THE SERVER SENDS NUMBERS AND THE CLIENT NAMES THEM. That is the standing
problem behind every "promising, but what IS it" verdict in
docs/runbooks/capture-sweep.md: a payload arrives carrying `_id` 107 and
nothing says which boss, which event or which item that is. The client knows,
because it ships the tables — 463 of them — and `dw_collector.gamedata`
already decodes any one of them (docs/runbooks/game-data.md).

`game-names` and `game-catalog` read the handful of tables they need, by name.
This reads ALL of them, so an id can be looked up without knowing which table
it belongs to, and without waiting for the event to come round again.

Two directions, because the answer can be missing from either end:

    --id 107            every table holding a row 107, with its text resolved
    --grep "titan|ice"  every string matching that, then the rows that use it

`--grep` is usually the decisive one. `--id` tells you a row exists; `--grep`
tells you which id the thing you can already NAME actually has.

RUN IT WITHOUT INSTALLING THE PROJECT, which matters because `uv sync` has to
rewrite the console-script shims and Windows refuses while the collector is
running:

    uv run --no-project --python 3.12 --with "UnityPy>=1.25" --with "lupa>=2.8" `
      python C:\\darkwar-platform\\services\\collector\\scripts\\game_lookup.py `
      --bundles C:/DW_data/gamedata/base --bundles C:/DW_data/gamedata/bundles `
      --grep "tundra|titan|ice pit"

Base pack first, downloaded patches after: a later folder's table wins, the
same order `game-catalog` takes. The script puts `src/` on `sys.path` itself,
so no PYTHONPATH and no install.

It writes nothing, anywhere. It only reads the copied bundles.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dw_collector.gamedata import (
    datatable_bytes,
    decode,
    localisation,
    read_dir,
)

# Where a decodable table sits inside a bundle: `.../luadatatable/<name>.bytes`.
MARKER = "/luadatatable/"


def table_names(assets: Mapping[str, bytes]) -> list[str]:
    """Every datatable in these bundles, by the name `datatable_bytes` takes."""
    return sorted(
        {
            path.rsplit(MARKER, 1)[1][: -len(".bytes")]
            for path in assets
            if MARKER in path and path.endswith(".bytes")
        }
    )


def each_table(
    assets: Mapping[str, bytes], names: list[str], *, noisy: bool
) -> Iterator[tuple[str, dict[str, dict[str, Any]]]]:
    """Decode every table, skipping the ones that will not decode.

    A bundle carries assets that are not datatables, and a patched bundle can
    carry one this decoder does not handle. Neither is worth stopping for: the
    point is to sweep everything that CAN be read, and a sweep that dies on
    table 40 of 463 answers nothing.
    """
    for index, name in enumerate(names, start=1):
        if noisy and index % 25 == 0:
            print(f"  … {index}/{len(names)}", file=sys.stderr)
        try:
            rows = decode(datatable_bytes(assets, name), name).rows
        except Exception as exc:
            if noisy:
                print(f"  (skipped {name}: {type(exc).__name__})", file=sys.stderr)
            continue
        yield name, rows


def as_key(value: Any) -> str | None:
    """The localisation key this field would be, or None if it cannot be one.

    Localisation keys are digits. A float is only a key when it is whole —
    truncating 1.5 to "1" would invent a match that the client never makes.
    `bool` is an `int` in Python and never a key, so it goes first.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return value.strip() if value.strip().isdigit() else None
    return None


def named_fields(row: Mapping[str, Any], text: Mapping[str, str]) -> dict[str, str]:
    """The row's fields that are localisation keys, resolved to their strings.

    The client's own two-step — id → table field → localisation — which is what
    turns a row of numbers into something a person can recognise.
    """
    out: dict[str, str] = {}
    for field, value in row.items():
        key = as_key(value)
        if key is not None and key in text:
            out[field] = text[key]
    return out


def by_id(
    assets: Mapping[str, bytes],
    names: list[str],
    text: Mapping[str, str],
    wanted: list[str],
    *,
    noisy: bool,
) -> None:
    """Every table holding one of these row ids, named where it can be."""
    hits = 0
    for table, rows in each_table(assets, names, noisy=noisy):
        for row_id in wanted:
            row = rows.get(row_id)
            if row is None:
                continue
            hits += 1
            resolved = named_fields(row, text)
            print(f"\n== {table}  [{row_id}]")
            for field, value in resolved.items():
                print(f"   {field} = {row[field]} → {value}")
            if not resolved:
                print("   (no field of this row is a localisation key)")
            print(f"   row: {row}")
    # MOST HITS ARE COINCIDENCE: a low id like 107 exists in dozens of
    # unrelated tables. Read the ones whose table name means something; the
    # count is not the answer.
    print(f"\n{hits} row(s) found across {len(names)} tables.")


def by_text(
    assets: Mapping[str, bytes],
    names: list[str],
    text: Mapping[str, str],
    pattern: str,
    *,
    noisy: bool,
) -> None:
    """Strings matching `pattern`, then the rows that point at them.

    COLLAPSED BY (table, field, string), because the raw form is unreadable.
    One `desc` shared by every one of a monster's 2,000 rows printed 2,000
    identical paragraphs, and the one row that mattered — the Tundra Titan's —
    was somewhere in the middle of it. The ids are what the reader came for, so
    they are kept; the paragraph is printed once.
    """
    matcher = re.compile(pattern, re.IGNORECASE)
    keys = {key: value for key, value in text.items() if matcher.search(value)}
    if not keys:
        print(f"No localised string matches {pattern!r}.")
        return
    print(f"{len(keys)} matching string(s):")
    for key, value in sorted(keys.items(), key=lambda item: int(item[0])):
        print(f"  {key:>10}  {clipped(value)}")

    print("\nRows pointing at them — the row's own id is the answer:")
    # (table, field, localisation key) → the row ids that use it.
    groups: dict[tuple[str, str, str], list[str]] = {}
    for table, rows in each_table(assets, names, noisy=noisy):
        for row_id, row in rows.items():
            for field, value in row.items():
                key = as_key(value)
                if key is not None and key in keys:
                    groups.setdefault((table, field, key), []).append(row_id)
    if not groups:
        print("  (none — the string exists but no table in these bundles points at it)")
        return
    for (table, field, key), ids in sorted(groups.items()):
        print(f"\n== {table}.{field} = {key} → {clipped(keys[key])}")
        print(f"   {len(ids)} row(s): {summarised(ids)}")


def clipped(value: str, limit: int = 110) -> str:
    """One line, short enough to scan. The full string is a key away."""
    flat = " ".join(value.split())
    return flat if len(flat) <= limit else f"{flat[:limit]}…"


def summarised(ids: list[str], show: int = 8) -> str:
    """The ids, or the ends of a long run of them.

    A thousand ids is not a list anybody reads, but WHICH ids is still the
    answer, so the first and last few are kept rather than a bare count.
    """
    if len(ids) <= show:
        return ", ".join(ids)
    return f"{', '.join(ids[: show - 2])} … {', '.join(ids[-2:])}"


# The client ships 463 tables; the device's AssetBundles folder holds only the
# ones a patch has replaced (docs/runbooks/game-data.md).
EVERY_TABLE = 463


def warn_if_patches_only(names: list[str]) -> None:
    """Say so when this is the patch folder rather than the whole client.

    THE FAILURE THIS EXISTS FOR IS SILENT. A sweep of 49 tables prints a
    confident "no table holds that id" and looks like an answer, when what it
    means is that 414 tables were never opened. The giveaway is the alphabet:
    the device's folder carried only names from a to g, so anything later could
    not have been found whether it was there or not.
    """
    if len(names) >= EVERY_TABLE:
        return
    first, last = names[0][:1], names[-1][:1]
    print(
        f"  WARNING: {len(names)} of about {EVERY_TABLE} tables, names {first} to {last}.\n"
        "  This looks like the patch bundles alone. The rest are in the APK's\n"
        "  split_install_time_pack.apk (docs/runbooks/game-data.md); pass that\n"
        "  folder as a first --bundles or an id you do not find may simply be\n"
        "  in a table that was never opened.",
        file=sys.stderr,
    )


def list_tables(names: list[str], pattern: str) -> None:
    """The table names matching a regex.

    ABSENCE IS EVIDENCE, and it was not reachable before. With all 463 tables
    loaded, "no table is called anything like boss" says the client does not
    hold the thing being hunted — which is a real answer, and the one that
    stops a search going round again.
    """
    matcher = re.compile(pattern, re.IGNORECASE)
    hits = [name for name in names if matcher.search(name)]
    print(f"{len(hits)} of {len(names)} table names match {pattern!r}:")
    for name in hits:
        print(f"  {name}")
    if not hits:
        print("  (none — the client ships no table named anything like that)")


def dump_table(
    assets: Mapping[str, bytes], text: Mapping[str, str], table: str, limit: int
) -> None:
    """Every row of one table, with its text resolved.

    Once a table is identified, the question stops being "where is this id"
    and becomes "what ids does this table have" — which `--id` and `--grep`
    cannot answer, because both need you to already know what you are after.
    """
    try:
        rows = decode(datatable_bytes(assets, table), table).rows
    except KeyError:
        print(f"No table called {table!r}. Try --list to find its real name.")
        return
    print(f"{table}: {len(rows)} row(s), columns {sorted({c for r in rows.values() for c in r})}")
    for index, (row_id, row) in enumerate(rows.items()):
        if index >= limit:
            print(f"\n  … {len(rows) - limit} more; raise --rows to see them")
            break
        named = named_fields(row, text)
        print(f"\n== {table}  id={row_id}")
        for field, value in named.items():
            print(f"   {field} = {row[field]} → {clipped(value)}")
        print(f"   row: {row}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Look an unnamed game id up in the client's datatables.",
        epilog='e.g. --grep "tundra|titan|ice pit"   or   --id 107   or   --list boss',
    )
    parser.add_argument(
        "--bundles",
        action="append",
        required=True,
        type=Path,
        help="an AssetBundles folder; repeat it, base pack first (a later folder wins)",
    )
    parser.add_argument("--language", default="English", help="localisation folder name")
    parser.add_argument("--id", action="append", default=[], help="a row id to look up; repeatable")
    parser.add_argument("--grep", help="a regex to match localised strings against")
    parser.add_argument("--list", help="a regex to match TABLE NAMES against")
    parser.add_argument("--table", help="dump every row of this table")
    parser.add_argument("--rows", type=int, default=40, help="rows --table prints (default 40)")
    parser.add_argument("--quiet", action="store_true", help="no progress on stderr")
    args = parser.parse_args()

    if not any([args.id, args.grep, args.list, args.table]):
        parser.error("give at least one of --id, --grep, --list, --table")

    assets: dict[str, bytes] = {}
    for folder in args.bundles:
        before = len(assets)
        assets.update(read_dir(folder))
        print(f"{folder}: {len(assets) - before:+} assets", file=sys.stderr)
    if not assets:
        parser.error("those folders hold no *.bundle files")

    text = localisation(assets, args.language)
    names = table_names(assets)
    print(f"{len(names)} datatables, {len(text)} {args.language} strings", file=sys.stderr)
    if not names:
        parser.error("no datatables in those bundles — is this the right folder?")
    warn_if_patches_only(names)
    print(file=sys.stderr)

    # Cheapest first: --list and --table open one table or none, while --grep
    # and --id decode all 463. Somebody running every flag at once should see
    # the quick answers before the sweep starts.
    noisy = not args.quiet
    printed = False
    for ran, run in (
        (args.list, lambda: list_tables(names, args.list)),
        (args.table, lambda: dump_table(assets, text, args.table, args.rows)),
        (args.grep, lambda: by_text(assets, names, text, args.grep, noisy=noisy)),
        (args.id, lambda: by_id(assets, names, text, [str(x) for x in args.id], noisy=noisy)),
    ):
        if not ran:
            continue
        if printed:
            print("\n" + "-" * 60)
        run()
        printed = True
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
