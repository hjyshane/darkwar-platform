# dw-collector

One Python package, several processes. Capture must not stop because a UI
workflow hung or the cloud went away, so each entrypoint runs on its own.

| Entrypoint | Role |
|---|---|
| `dw-capture` | TCP 8680 reassembly, SmartFox decode, emits `Observation` |
| `dw-sync` | SQLite outbox → Supabase, at-least-once with idempotent upsert |
| `dw-jobs` | Pulls refresh jobs from Supabase, runs them locally |
| `dw-ui-worker` | ADB workflows against the collector BlueStacks instance |
| `dw-collector` | Admin CLI: `init-db`, `replay`, `status` |

## The boundary

Everything upstream of `Observation` is capture. Everything downstream is
plain data processing that runs anywhere:

```
capture ─┐
         ├─→ Observation ─→ parsers ─→ normalize ─→ SQLite ─→ outbox ─→ Supabase
replay ──┘
```

`replay` feeds hand-authored or sanitized fixtures through the identical path,
which is how the pipeline gets tested without Npcap, BlueStacks, or a live
game session. Nothing below `capture/` may import scapy or assume a socket.

## Install

```bash
uv sync --directory services/collector              # no capture deps
uv sync --directory services/collector --extra capture   # Windows + Npcap
```

uv installs and pins Python 3.12 itself (`.python-version`); the system
interpreter is not used.

## Run

```bash
uv run dw-collector init-db
uv run dw-collector replay --fixture ../../protocol-fixtures/decoded/al.rank/synthetic_roster_v1.json
uv run pytest
```

## Safety

`DW_ADB_COLLECTOR_SERIAL` names the only instance automation may drive.
`DW_ADB_DENYLIST_SERIALS` names instances it must refuse to touch — the main
account belongs there (FR-COL-010). Both are checked before any ADB command,
and the kill switch (FR-OPS-006) stops all UI automation immediately.
