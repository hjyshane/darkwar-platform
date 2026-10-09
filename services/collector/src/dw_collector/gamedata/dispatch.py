"""The client's hero dispatch missions, reduced to what the map needs (0254).

`aps_dispatch_tasks` has one row per mission id. The map's dispatch tiles
(object type 21) carry that id, so this table is what turns "mission
1500203" into "a gold mission that runs two hours and pays six Orange Skill
Books when plundered".

A reward spec is ``item;type;amount|item;type;amount``. Type 7 is a real item
(`230101` is the Orange Skill Book); the others are resources written as small
ids that nobody has named yet. Only the Orange Skill Book is counted here; the
whole list is kept in `steal_items` / `base_items` so nothing is thrown away.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from dw_collector.gamedata.luatable import decode
from dw_collector.gamedata.names import datatable_bytes

TABLE = "aps_dispatch_tasks"
ORANGE_SKILL_BOOK = "230101"
_ITEM_TYPE = "7"


def _spec(raw: object) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for part in str(raw or "").split("|"):
        pieces = part.split(";")
        if len(pieces) != 3 or not pieces[2].isdigit():
            continue
        out.append({"id": pieces[0], "type": pieces[1], "amount": int(pieces[2])})
    return out


def _books(rewards: list[dict[str, Any]]) -> int:
    return sum(
        r["amount"] for r in rewards if r["id"] == ORANGE_SKILL_BOOK and r["type"] == _ITEM_TYPE
    )


def build(assets: Mapping[str, bytes]) -> list[dict[str, Any]]:
    """One row per mission id, shaped for game_dispatch_missions."""
    rows = decode(datatable_bytes(assets, TABLE), TABLE).rows
    out: list[dict[str, Any]] = []
    for key, row in sorted(rows.items(), key=lambda item: int(item[0])):
        steal = _spec(row.get("steal_reward_show"))
        base = _spec(row.get("base_reward_show"))
        out.append(
            {
                "mission_id": int(key),
                "color": int(row["color"]),
                "star": row.get("task_star"),
                "duration_seconds": int(row["times"]),
                "steal_max": row.get("steal_maxtimes"),
                "is_special": bool(row.get("is_special")),
                "orange_books": _books(steal),
                "steal_items": steal,
                "base_items": base,
            }
        )
    return out
