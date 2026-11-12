---
name: promote-command
description: Promote a captured game command from "verdict" to a working parser — normalizer, sanitized fixture, tests, catalog entry, table/migration, dashboard reader — as one PR, so a verdict is never left half-done. Use when asked to promote, parse, or normalize a command from the capture sweep, or when turning a legacy/ parser into the new package.
---

# Promoting a command

**A verdict is not a promotion.** `al.battle.rank.info` was marked "promote" and
never had a writer, so a dashboard column stayed permanently empty. A promotion
is done only when the chain below is closed — or you say plainly what is outstanding.

Chain: **verdict → fixture → normalizer → registered → catalog → table → reader → test.**

## 0. Judge it first

A UID in the payload is not enough. Read `docs/runbooks/capture-sweep.md` for the
verdict and evidence; three commands were rejected after their fields meant
something else. Passive default holds: promotion never adds a request the
collector sends (ADR-0002/0003 govern that, not this task).

## 1. Fixture (`protocol-fixtures/decoded/<command>/`)

- Real payload from the journal/PCAP, **sanitized** (`dw_collector/sanitize.py`):
  no session signature, no collector UID. Raw PCAPs never enter the repo
  (hooks block it).
- Cover the cases `al.rank/` has: `<name>_v1.json` (normal), `*_nulls_v1.json`
  (optional fields null), `*_malformed_v1.json`, and a redacted variant. The
  duplicate case is a test that feeds the same observation twice (keys must
  collide, not multiply). A thin fixture makes working code look broken —
  use a payload with enough rows to exercise ordering and ranking.

## 2. Normalizer (`services/collector/src/dw_collector/normalize/<name>.py`)

Model it on `alliance_donate_rank.py`:

- `@register("<command>")`, `PARSER_VERSION = "1.0.0"`, pydantic model with
  `extra="allow"` so unknown fields survive into `raw`.
- **`idempotency_key` hashes the raw decoded payload, never the normalized row**
  (a version bump must not duplicate history on replay; a test pins this).
- `server_id` = the **subject's** server (UID suffix), not `collected_from_server_id`.
- Add the module to `normalize/__init__.py` (import + `__all__`), or it never registers.
- Nothing below `capture/` may import scapy or assume a socket (the Observation seam).

## 3. Test (`services/collector/tests/test_normalize_<name>.py`)

`test_registered`, real payload (row count, target table, unique keys, top row
values), null/optional, malformed (`ValidationError`), duplicate. Prefer fixture
coverage over line coverage.

## 4. Catalog

Update `command_catalog.json` (`status`: promoted | rejected | hold | promising |
recapture | reference; `verdict` text with date, parser version, migration number)
and the matching row in `docs/runbooks/capture-sweep.md`.
`tests/test_command_catalog.py` is the documentation — keep it green.

## 5. Table and reader

New or changed target table → follow the `new-migration` skill. Then find the
reader: the dashboard feature / view that was waiting for it, and the writer
(`contribution_type` or equivalent) it filters on. If you cannot close that
end in this PR, **write it into `docs/handover.md` §3/§4** as outstanding.

## 6. Run

```bash
cd services/collector && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
```

One parser per PR (NFR-009). Track a legacy file's verdict in `docs/legacy-triage.md`;
never edit `legacy/`.
