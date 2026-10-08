"""The migration rules the client is given at login -> migration_config_snapshots.

`init` (parsed in account_state.py, which calls `config_rows`) carries the
game's server-side config in `dataConfig`. Two of its blocks drive the
Migration screen (MigrateDataManager reads them with `DataConfig:TryGetStr`):

  aps_migrate_server
    k6   four migrate-power cutoffs, `;`-separated: 10M, 15M, 25M, 35M on
         2026-10-08. They split players into the four levels (General / Mid /
         High / Special in the client).
    k2   four `|`-separated groups of power brackets, each ending in
         9999999999. One group per level.
    k1, k3, k4, k5, k7  a power limit, a count, two 2880-minute (48 h) spans and
         a switch; what each is for has not been established.
  migration_quota
    k1..k3  rank-range -> parameter strings, `1-88;0.6,1.5,12|89-324;...`
    k6      one icon set per level
    (the quota formula lives in bytecode we cannot read; see the runbook)

`function_on_config.immigration_new` is the switch for the new migration screen.
It was 0 on 2026-10-08, which is why the tab is not visible.

Only the config is read here, so a login that carries none writes nothing. The
whole blocks go to `raw`; the columns are the two readings the dashboard needs.
`login.init` carries the same blocks and is not parsed: `init` is the one the
collector's account sends on every login.
The key hashes the blocks and the UTC day: an unchanged config is one row a day,
and a config that changes (the switch turning on, a cutoff moving) is a new one.
"""

from __future__ import annotations

from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.normalize.migration_servers import int_list

PARSER_VERSION = "1.0.0"
KEY_COMMAND = "migration.config"


def _groups(value: Any) -> list[list[int]] | None:
    """`a;b|c;d` as `[[a, b], [c, d]]`; null if any group is not all integers."""
    if not isinstance(value, str) or value == "":
        return None
    groups = [int_list(part) for part in value.split("|")]
    return None if any(g is None for g in groups) else [g for g in groups if g is not None]


def _switch(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    return None


def _block(payload: dict[str, Any], section: str, name: str) -> dict[str, Any] | None:
    outer = payload.get(section)
    block = outer.get(name) if isinstance(outer, dict) else None
    return block if isinstance(block, dict) else None


def config_rows(observation: Observation) -> list[NormalizedRow]:
    payload = observation.payload
    aps = _block(payload, "dataConfig", "aps_migrate_server")
    quota = _block(payload, "dataConfig", "migration_quota")
    if aps is None and quota is None:
        return []
    switches = payload.get("function_on_config")
    switch = switches.get("immigration_new") if isinstance(switches, dict) else None
    raw: dict[str, Any] = {
        "aps_migrate_server": aps,
        "migration_quota": quota,
        "immigration_new": switch,
    }
    captured = observation.captured_at
    key = entry_idempotency_key(
        observation, "migration_config", captured.strftime("%Y-%m-%d"), raw, key_command=KEY_COMMAND
    )
    return [
        NormalizedRow(
            target_table="migration_config_snapshots",
            idempotency_key=key,
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": captured.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": raw,
                "snapshot_id": str(stable_uuid(key)),
                "power_tier_floors": int_list(aps.get("k6")) if aps else None,
                "power_brackets": _groups(aps.get("k2")) if aps else None,
                "new_migrate_on": _switch(switch),
            },
        )
    ]
