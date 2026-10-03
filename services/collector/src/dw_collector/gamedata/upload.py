"""Write the game's own event names into event_names (0208).

event_names is also where officers type names. A row with `updated_by` set
was written by a person and is never touched. A row with `updated_by` null
was written here, so a later run may refresh it when the game renames the
event, and leaves it alone when the name is the same.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx

from dw_collector.gamedata.names import EventName

# The note on every row this writes, so the page and a reader of the table
# can tell a name the game gave from one an officer gave.
NOTE = "from the game client's activity_panel table"


@dataclass(frozen=True)
class Plan:
    # Whole rows this tool owns: new ids, and its own rows that changed.
    to_write: list[dict[str, Any]]
    # Officer-named rows: only the game facts, never the name (0210). The
    # category is set only where nobody has chosen one.
    to_classify: list[dict[str, Any]]
    unchanged: int
    kept_human: int


def _full(activity_id: str, event: EventName) -> dict[str, Any]:
    return {
        "activity_id": activity_id,
        "name": event.name,
        "note": NOTE,
        "activity_type": event.activity_type,
        "category": event.category,
    }


def plan(existing: Iterable[Mapping[str, Any]], names: Mapping[str, EventName]) -> Plan:
    """What to write, given what the table already holds."""
    current = {str(row["activity_id"]): row for row in existing}
    to_write: list[dict[str, Any]] = []
    to_classify: list[dict[str, Any]] = []
    unchanged = kept_human = 0
    for activity_id, event in sorted(names.items(), key=lambda item: int(item[0])):
        row = current.get(activity_id)
        if row is None:
            to_write.append(_full(activity_id, event))
        elif row.get("updated_by") is not None:
            kept_human += 1
            patch: dict[str, Any] = {}
            if row.get("activity_type") != event.activity_type:
                patch["activity_type"] = event.activity_type
            if row.get("category") is None:
                patch["category"] = event.category
            if patch:
                to_classify.append({"activity_id": activity_id, **patch})
        elif (
            row.get("name"),
            row.get("activity_type"),
            row.get("category"),
        ) == (event.name, event.activity_type, event.category):
            unchanged += 1
        else:
            to_write.append(_full(activity_id, event))
    return Plan(to_write, to_classify, unchanged, kept_human)


def fetch_existing(client: httpx.Client) -> list[dict[str, Any]]:
    resp = client.get(
        "/rest/v1/event_names",
        params={"select": "activity_id,name,updated_by,activity_type,category", "limit": 10000},
    )
    resp.raise_for_status()
    rows: list[dict[str, Any]] = resp.json()
    return rows


def upsert(client: httpx.Client, rows: list[dict[str, Any]]) -> None:
    """`updated_by` is left to its default — null under the service key — so
    every row written here stays refreshable by the next run."""
    upsert_rows(client, "event_names", rows, "activity_id")


def classify(client: httpx.Client, patches: list[dict[str, Any]]) -> None:
    """One PATCH per officer-named row. Not an upsert: `name` is NOT NULL, and
    an upsert's insert half would need one this must not write."""
    for patch in patches:
        fields = {k: v for k, v in patch.items() if k != "activity_id"}
        resp = client.patch(
            "/rest/v1/event_names",
            params={"activity_id": f"eq.{patch['activity_id']}"},
            json=fields,
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()


def fill_hero_names(client: httpx.Client, names: Mapping[int, str]) -> tuple[int, int]:
    """Name heroes the catalogue has not named (0037). A name an admin typed
    is kept: the game's own name only fills a null, and a hero the catalogue
    has never seen is added with it. Returns (written, kept)."""
    resp = client.get("/rest/v1/heroes", params={"select": "hero_id,name", "limit": 2000})
    resp.raise_for_status()
    existing = resp.json()
    typed = {int(row["hero_id"]) for row in existing if row.get("name")}
    # Names are unique in the catalogue (heroes_name_key, on lower(name)). A
    # name already on another hero stays where an admin put it.
    taken = {str(row["name"]).lower(): int(row["hero_id"]) for row in existing if row.get("name")}
    rows = [
        {"hero_id": hid, "name": name}
        for hid, name in sorted(names.items())
        if hid not in typed and taken.get(name.lower(), hid) == hid
    ]
    upsert_rows(client, "heroes", rows, "hero_id")
    return len(rows), len(typed & set(names))


# PostgREST takes a large body, but a 16,000-row upsert in one statement
# holds its locks for the whole of it on a micro instance members are using.
BATCH = 1000


def upsert_rows(
    client: httpx.Client, table: str, rows: list[dict[str, Any]], on_conflict: str
) -> int:
    """Upsert in batches; returns rows sent. The catalogue is the game's, so
    a later run overwrites in place — there is nobody's edit to preserve."""
    for start in range(0, len(rows), BATCH):
        resp = client.post(
            f"/rest/v1/{table}",
            params={"on_conflict": on_conflict},
            json=rows[start : start + BATCH],
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        resp.raise_for_status()
    return len(rows)
