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
| `darkwar_tracker/collector.py` | reference | Capture loop shape; ours is the `Observation` seam + `dw-capture` |
| `darkwar_tracker/database.py` | reference (al.rank done) | al.rank mapping + redaction heuristic promoted into `normalize/al_rank.py`; remaining commands still to mine |
| `darkwar_tracker/offline.py` | **PROMOTED** (S14-PR1) | → `dw_collector/protocol/pcapng.py` + `dw-collector extract-fixture` (sanitizing) |
| `darkwar_tracker/config.py` | discard | Replaced by env vars + pyproject |
| `darkwar_tracker/dashboard.py` | discard | Replaced by `apps/dashboard` |
| `darkwar_tracker/activity_api.py` | reference | FastAPI Discord Activity API → S13 Edge Function + adapter design |
| `darkwar_tracker/adb_control.py` | **adopt** | `ui_worker/` — ADB serial allowlist/denylist logic (FR-COL-001/010) |
| `darkwar_tracker/arena_automation.py` | reference | Tap-sequence workflow shape → `ui_worker` refresh workflows |
| `darkwar_tracker/refresh_worker.py` | reference | Idle-aware refresh queue → `dw-jobs` consuming `refresh_jobs` |
| `darkwar_tracker/refresh_control.py` | reference | With refresh_worker.py |
| `darkwar_tracker/idle_detection.py` | **adopt** | `ui_worker/` — Windows idle detection (FR-COL-009 politeness) |
| `darkwar_tracker/migrate.py` | discard | SQLite migrations; new journal owns its schema |
| `darkwar_tracker/__init__.py` | discard | Version marker only |
| `scripts/test_bytes_payload.py` | reference | Malformed/bytes cases → parser fixture ideas |
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
4. `get.al.info` (capture exists in `darkwar_alliance_rank_580_T2.pcapng`)
   / `server.rank` (capture TBD) / `get.new.user.info`
   (`darkwar_player_profile_cp.pcapng`) — one parser per PR
