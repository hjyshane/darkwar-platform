"""Every client datatable, laid out for the dashboard's browser (0343).

The other gamedata modules each read ONE thing the client knows and shape it
for a screen: event names, item costs, dispatch missions. This one keeps
nothing back. Each of the client's ~470 datatables is written whole, so an
admin can open any of them in the dashboard, see its rows in English or
Korean, and follow an id into the table it points at — without a Python
session and without asking which table a number lives in.

What is derived, and how:

- **Localised columns.** A localisation key is a 6-8 digit number; so is an
  item id. A column is called localised when at least `LOC_SHARE` of its
  non-empty values are keys the English dictionary knows. `id` and `*_id`
  columns never are, so a table whose ids happen to collide with string keys
  is not mis-read as text.
  The dashboard shows the string and keeps the key under it.
- **Strings per table.** Only the keys a table's localised columns use, in
  each language — not the whole 35k-line dictionary on every screen.
- **Name index.** One row per entity for tables with a localised `name`
  (or `title`) column, so "Orange Skill Book" can be typed into one box and
  answered with the table and row it lives in.
- **Chunks.** Rows go up in `CHUNK`-row jsonb pieces. PostgREST answers one
  row at a time happily however large, but a 14 MB `building` table as one
  document is a 14 MB wait before anything is drawn; eleven pieces load in
  parallel and the first paints at once.

Nothing here decides what a column MEANS — that is the catalogue's job, one
table at a time, after a human has read it.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from dw_collector.gamedata.luatable import Datatable, DatatableError, decode
from dw_collector.gamedata.names import localisation

CHUNK = 1000
LOC_SHARE = 0.8
NAME_COLUMNS = ("name", "title", "Name")
LANGUAGES: Mapping[str, str] = {"en": "English", "ko": "Korean"}
DATATABLE_MARK = "/luadatatable/"


@dataclass(frozen=True)
class TableDump:
    name: str
    columns: tuple[str, ...]
    loc_columns: tuple[str, ...]
    # Row id -> row, every column present (None where Lua had nil).
    rows: dict[str, dict[str, Any]]
    # Language code -> key -> text, only the keys this table's rows use.
    strings: dict[str, dict[str, str]]
    # (row id, English name, Korean name) for the search index; empty when the
    # table has no name column.
    names: tuple[tuple[str, str | None, str | None], ...]

    @property
    def byte_size(self) -> int:
        return len(json.dumps(self.rows, ensure_ascii=False, separators=(",", ":")))


@dataclass(frozen=True)
class Dump:
    tables: tuple[TableDump, ...]
    # Table name -> why it did not decode. Reported, never hidden: a table that
    # vanished from the browser after a client update should say so.
    failures: dict[str, str]


def _is_key(value: Any, keys: Mapping[str, str]) -> bool:
    return isinstance(value, str | int) and not isinstance(value, bool) and str(value) in keys


def loc_columns(table: Datatable, keys: Mapping[str, str]) -> tuple[str, ...]:
    """The columns that hold localisation keys rather than numbers."""
    out: list[str] = []
    for column in table.columns:
        if column.lower() == "id" or column.lower().endswith("_id"):
            continue
        values = [row[column] for row in table.rows.values() if row[column] not in (None, "", 0)]
        if not values:
            continue
        hits = sum(1 for value in values if _is_key(value, keys))
        if hits / len(values) >= LOC_SHARE:
            out.append(column)
    return tuple(out)


def _row_order(row_id: str) -> tuple[int, int | str]:
    return (0, int(row_id)) if row_id.lstrip("-").isdigit() else (1, row_id)


def dump_table(
    name: str, table: Datatable, languages: Mapping[str, Mapping[str, str]]
) -> TableDump:
    """One datatable with its strings and its name index.

    `languages` maps a code (`en`, `ko`) to that language's dictionary; the
    first one decides which columns are localised."""
    first = next(iter(languages.values()), {})
    localised = loc_columns(table, first)
    rows = {row_id: table.rows[row_id] for row_id in sorted(table.rows, key=_row_order)}
    used = {
        str(row[column])
        for row in rows.values()
        for column in localised
        if row[column] not in (None, "")
    }
    strings = {
        code: {key: text[key] for key in used if key in text} for code, text in languages.items()
    }
    name_column = next((c for c in NAME_COLUMNS if c in localised), None)
    names: tuple[tuple[str, str | None, str | None], ...] = ()
    if name_column is not None:
        en, ko = strings.get("en", {}), strings.get("ko", {})
        names = tuple(
            (row_id, en.get(str(row[name_column])), ko.get(str(row[name_column])))
            for row_id, row in rows.items()
            if row[name_column] not in (None, "")
        )
    return TableDump(name, table.columns, localised, rows, strings, names)


def chunks(dump: TableDump) -> list[dict[str, dict[str, Any]]]:
    """The rows in `CHUNK`-row pieces, in id order."""
    items = list(dump.rows.items())
    return [dict(items[start : start + CHUNK]) for start in range(0, len(items), CHUNK)]


def datatables(assets: Mapping[str, bytes]) -> dict[str, bytes]:
    """Every datatable in the bundles, by name."""
    return {
        path.rsplit("/", 1)[1][: -len(".bytes")]: data
        for path, data in assets.items()
        if DATATABLE_MARK in path and path.endswith(".bytes")
    }


def build(assets: Mapping[str, bytes], only: Iterable[str] | None = None) -> Dump:
    """Decode every datatable (or `only` the named ones) with both languages."""
    languages = {code: localisation(assets, language) for code, language in LANGUAGES.items()}
    wanted = None if only is None else set(only)
    tables: list[TableDump] = []
    failures: dict[str, str] = {}
    for name, data in sorted(datatables(assets).items()):
        if wanted is not None and name not in wanted:
            continue
        try:
            table = decode(data, name)
        except DatatableError as exc:
            failures[name] = str(exc)
            continue
        tables.append(dump_table(name, table, languages))
    return Dump(tuple(tables), failures)


def metadata_row(dump: TableDump, client_version: str, dumped_at: datetime) -> dict[str, Any]:
    return {
        "name": dump.name,
        "client_version": client_version,
        "columns": list(dump.columns),
        "loc_columns": list(dump.loc_columns),
        "row_count": len(dump.rows),
        "chunk_count": (len(dump.rows) + CHUNK - 1) // CHUNK,
        "byte_size": dump.byte_size,
        "dumped_at": dumped_at.isoformat(),
    }


def write_json(dump: Dump, out: Path, client_version: str) -> None:
    """The same shape the database holds, as files, for looking at by hand."""
    dumped_at = datetime.now(UTC)
    (out / "tables").mkdir(parents=True, exist_ok=True)
    index = {
        "client_version": client_version,
        "tables": [metadata_row(table, client_version, dumped_at) for table in dump.tables],
        "failures": dump.failures,
    }
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), "utf-8")
    for table in dump.tables:
        document = {
            "columns": table.columns,
            "loc_columns": table.loc_columns,
            "rows": table.rows,
            "strings": table.strings,
        }
        (out / "tables" / f"{table.name}.json").write_text(
            json.dumps(document, ensure_ascii=False, separators=(",", ":")), "utf-8"
        )


# ------------------------------------------------------------------ upload

_MINIMAL = {"Prefer": "return=minimal"}
_MERGE = {"Prefer": "resolution=merge-duplicates,return=minimal"}
NAMES_BATCH = 1000


def _replace(client: httpx.Client, table: str, name: str, rows: list[dict[str, Any]]) -> None:
    """Delete a table's rows and write the new ones. Not an upsert: a chunk or a
    name that no longer exists has to go, and merge-duplicates cannot say so."""
    client.delete(f"/rest/v1/{table}", params={"table_name": f"eq.{name}"}).raise_for_status()
    for start in range(0, len(rows), NAMES_BATCH):
        client.post(
            f"/rest/v1/{table}", json=rows[start : start + NAMES_BATCH], headers=_MINIMAL
        ).raise_for_status()


def upload_table(
    client: httpx.Client, dump: TableDump, client_version: str, dumped_at: datetime
) -> None:
    client.post(
        "/rest/v1/game_datatables",
        params={"on_conflict": "name"},
        json=[metadata_row(dump, client_version, dumped_at)],
        headers=_MERGE,
    ).raise_for_status()
    # One chunk per request: a request is one jsonb document, and the biggest
    # table's whole body would be the one request most likely to time out.
    client.delete(
        "/rest/v1/game_datatable_rows", params={"table_name": f"eq.{dump.name}"}
    ).raise_for_status()
    for index, piece in enumerate(chunks(dump)):
        client.post(
            "/rest/v1/game_datatable_rows",
            json=[{"table_name": dump.name, "chunk": index, "rows": piece}],
            headers=_MINIMAL,
        ).raise_for_status()
    _replace(
        client,
        "game_datatable_strings",
        dump.name,
        [
            {"table_name": dump.name, "lang": code, "strings": text}
            for code, text in dump.strings.items()
        ],
    )
    _replace(
        client,
        "game_datatable_names",
        dump.name,
        [
            {"table_name": dump.name, "row_id": row_id, "name_en": en, "name_ko": ko}
            for row_id, en, ko in dump.names
        ],
    )


def upload(client: httpx.Client, dump: Dump, client_version: str) -> tuple[int, int]:
    """Write every table; drop the ones the client no longer ships.

    Returns (tables written, tables removed)."""
    dumped_at = datetime.now(UTC)
    for table in dump.tables:
        upload_table(client, table, client_version, dumped_at)
    resp = client.get("/rest/v1/game_datatables", params={"select": "name", "limit": 5000})
    resp.raise_for_status()
    present = {table.name for table in dump.tables}
    stale = [row["name"] for row in resp.json() if row["name"] not in present]
    for name in stale:
        # The child tables cascade from this one.
        client.delete("/rest/v1/game_datatables", params={"name": f"eq.{name}"}).raise_for_status()
    return len(dump.tables), len(stale)
