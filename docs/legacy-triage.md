# legacy/v0.4.1 triage

Imported 2026-07-28 from `darkwar_tracker_v0.4.0.zip` (sha256 in the import
commit), the latest surviving snapshot of what the spec calls v0.4.1 —
`__version__` reads 0.4.0 and no distinct 0.4.1 artifact exists.
Data artifacts (PCAP, SQLite, `.env`) stay outside the repo at
`C:\darkwar-adb`.

**Rules** (CLAUDE.md): read-only reference. Promotion = read → rewrite in
the new package → sanitized fixture → replay test, **one parser per PR**
(NFR-009). When no row remains open, `git rm -r legacy/`.

## Decisions informed by the legacy data

- **D-1 CONFIRMED (2026-07-28)**: `game_uid` is globally unique across the
  server group — the uid literally embeds the home server id as a suffix
  (`1000103874000580` … `1532934922000580`, all ending `…000580`). The
  legacy DB has 191 distinct uids, none under more than one server.
  Migration 0002's global `game_uid unique` stands. Bonus: a player's home
  server can be derived from the uid itself.
- Legacy `member_entries` already separates `server_id` from
  `current_server_id` — same subject-vs-provenance split as our schema.
- Legacy `config.toml` confirms Monday 02:00 UTC reset
  (`reset_hour_utc = 2`, `weekly_weekday_utc = 0`).

## Verdicts

adopt = rewrite into `services/collector` with fixtures ·
reference = consult while building, then discard · discard = obsolete.

| File | Verdict | Target / note |
|---|---|---|
| `darkwar_tracker/protocol.py` | **PROMOTED** (S14-PR1) | → `dw_collector/protocol/{sfs,frames}.py` with synthetic + real-capture tests |
| `darkwar_tracker/reassembly.py` | **PROMOTED** (S14-PR1) | → `dw_collector/protocol/pcapng.py` (TCPDirectionReassembler) |
| `darkwar_tracker/collector.py` | **SUPERSEDED** (S15 prep) | `capture/session.py` (engine, testable without Npcap) + `capture/live.py` (thin scapy source) + `dw-capture` |
| `darkwar_tracker/database.py` | **MINED OUT** (S14) | Field mappings for all seven confirmed commands are promoted into `normalize/*.py`; nothing left to take |
| `darkwar_tracker/offline.py` | **PROMOTED** (S14) | → `protocol/pcapng.py`, `dw-collector extract-fixture` (sanitizing) and `scan-capture` (offline ingest + discovery) |
| `darkwar_tracker/config.py` | discard | Replaced by env vars + pyproject |
| `darkwar_tracker/dashboard.py` | discard | Replaced by `apps/dashboard` |
| `darkwar_tracker/activity_api.py` | reference | FastAPI Discord Activity API → S13 Edge Function + adapter design |
| `darkwar_tracker/adb_control.py` | **REPLACED** (S15 prep) | It has *no* denylist and falls back to `devices[0]`; `ui_worker/guard.py` was written against that gap, not ported from it. Shell/tap plumbing still to promote with the ADB workflows |
| `darkwar_tracker/arena_automation.py` | reference | Tap-sequence workflow shape → `ui_worker` refresh workflows |
| `darkwar_tracker/refresh_worker.py` | reference | Idle-aware refresh queue → `dw-jobs` consuming `refresh_jobs` |
| `darkwar_tracker/refresh_control.py` | reference | With refresh_worker.py |
| `darkwar_tracker/idle_detection.py` | **PROMOTED** (FR-COL-009) | → `ui_worker/idle.py`, gated per step in `runner.py` beside the kill switch. Its non-Windows short-circuit to `is_idle=True` was *not* carried over — a permission check that defaults to granted off its supported platform is the same gap as this file's sibling `adb_control.py` picking `devices[0]`. The probe is injected instead, so every branch is tested on Linux CI |
| `darkwar_tracker/migrate.py` | discard | SQLite migrations; new journal owns its schema |
| `darkwar_tracker/__init__.py` | discard | Version marker only |
| `scripts/test_bytes_payload.py` | **PROMOTED** (S14) | Its warning was real: SFS byte arrays broke JSON serialization; now a regression test in `test_protocol.py` |
| `scripts/test_null_rank_names.py` | reference | Null-name cases → parser fixture ideas |
| `scripts/test_player_profiles.py` | reference | 6-power profile cases → `get.new.user.info` fixtures |
| `scripts/seed_database.py` | discard | Replaced by `supabase/seed.sql` |
| `scripts/verify_install.py` | discard | Replaced by `uv sync` + CI |
| other `scripts/*` (calibrate/add-config/queue/test_*) | discard | Config plumbing for the old runtime |
| `activity/client/*` (Vite JS SPA) | reference | Screen inventory + Discord embed wiring → S13; code not reused |
| `*.bat`, `*.ps1`, `setup.bat`, autostart scripts | reference | Windows service wiring → runbooks at Gate 4 |
| `README.md`, `APPLY_PATCH.md`, `DISCORD_ACTIVITY_SETUP.md` | reference | Protocol/redaction notes; S13 tunnel setup |

## Promotion queue (one parser per PR)

1. ~~`protocol.py` decode path + `al.rank` parser~~ **done (S14-PR1)** —
   real sanitized fixture `decoded/al.rank/cbfw_roster_v1.json` (93
   members, provenance-pinned to `darkwar_alrank.pcapng`, sha256 in
   `manifests/`); found the alliance id is a 32-hex string → alliances
   `external_id` became text
2. ~~`user.get.arena.info` parser~~ **done (S14-PR2)** — real Top100
   fixture `decoded/user.get.arena.info/top100_580v582_v1.json`
   (matchup 580 vs 582; game startTime = Monday 02:00 UTC exactly).
   Fake uids are hash-derived so the 19 CBFW members in the Top100 keep
   one identity across fixtures
3. ~~`alliance.rank`~~ **done (S14-PR3)** — local(41, server 580) and
   cross(100, all eight servers) fixtures; alliance ids share the md5
   mapping so the local #1 stays identical to the roster fixture's
   alliance. rangeType is request-side only, so scope is recoverable from
   row data, not stored
4. ~~`get.al.info` / `server.rank` / `get.new.user.info` /
   `get.user.info.multi`~~ **done (S14-PR4…PR7)**

**The queue is empty: all seven confirmed Appendix B commands have
parsers, fixtures and replay tests**, and a test asserts that set stays
covered. `user.arena.save.defend.army` is deliberately unparsed — it is
the collector's own outbound write and has no product table.

The next parsers are for commands that are not confirmed yet. They now
have a discovery path rather than a capture backlog: `dw-collector
scan-capture` records unknown command shapes into `schema_observations`.
One login capture surfaced 132 of them, including
`get.alliance.duel.season.info`, `get.battlepass.info`,
`al.battle.week.result.info` and `chat.get.system.mails` — leads for the
event and season frameworks (§13/§14).

## Why `legacy/` is still here

No **adopt** row remains — every promotion the codebase needs today is
done. `git rm -r legacy/` is nonetheless premature, because four
`reference` rows point at work that has not started:

| Still needed by | Rows |
|---|---|
| **S13 Discord Activity** — not begun; no `supabase/functions/`, `DiscordRuntimeAdapter` is a comment | `activity_api.py`, `activity/client/*`, `DISCORD_ACTIVITY_SETUP.md` |
| **`dw-jobs`** — a nine-line stub that raises `SystemExit` | `refresh_worker.py`, `refresh_control.py` |
| **ADB workflows** — `guard.py`/`runner.py` exist, the tap-sequence library does not | `arena_automation.py`, `adb_control.py` shell/tap plumbing |

"reference" means consult while building, then discard. Two of those three
have not been built, so the material has not been consulted yet. Deleting
now would mean re-deriving from git history the moment S13 starts.

Delete when `dw-jobs` consumes `refresh_jobs`, the ADB workflow library
lands, and S13 has its Edge Function and adapter — whichever comes last.
