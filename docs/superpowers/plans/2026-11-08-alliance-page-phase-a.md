# Alliance Page Phase A (data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data layer for the alliance page: promoted `get.al.info` fields, the `alliance_info_latest` view with per-row `announce` gating, the `alliance_moves` RPC over `player_snapshots`, and the pure TypeScript modules phase B renders from.

**Architecture:** Two migrations (0309 info fields + view, 0310 moves RPC), each with a pgTAP file. The normalizer lifts the same eight fields the migration backfills from `raw`. Dashboard code is pure functions and thin query modules under `features/alliance/`; `AlliancePage.tsx` is untouched. Committed types in `packages/shared-types` are hand-edited to match (CI's db job verifies).

**Tech Stack:** PostgreSQL 17 / pgTAP, Supabase (PostgREST RPC, RLS), Python 3.12 + pydantic (collector), TypeScript + vitest (dashboard).

**Spec:** `docs/superpowers/specs/2026-11-08-alliance-page-design.md`

## Global Constraints

- Migration numbers: next free on `origin/main` is `0309` (highest is `20260728000308`). Re-check at push with `scripts/check-migration-order.sh`.
- Every new view: `with (security_invoker = true)`, `grant select ... to authenticated, service_role`, `revoke all ... from anon`. Every new function: `revoke all ... from public, anon`, `grant execute ... to authenticated, service_role`. (Hosted grants are point-in-time.)
- `(select public.current_app_role())` wrapped in a subselect wherever it appears in a policy, view or function body (0179).
- Hosted `pg_safeupdate`: every `update` carries a `where`.
- `announce` visibility is decided per row by an `alliance_memberships` row for `auth.uid()` and the snapshot's `alliance_id`, or admin. Never by `current_app_role()` alone.
- `join_approval` stores the raw payload integer. Its meaning is unconfirmed; the column comment says so. No boolean, no guessed sentence.
- Moves come from `player_snapshots` only. One row per move. `direction in ('in','out','relocated')`.
- Dashboard UI copy is English. `codes.ts` keeps a Korean column that nothing renders.
- Diff stays inside `apps/dashboard/src/features/alliance/`, `services/collector/`, `supabase/`, `packages/shared-types/`, `protocol-fixtures/`, and this plan.
- Python: `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest` from `services/collector`. TS: `pnpm check && pnpm typecheck && pnpm test`. SQL: `pnpm db:test:local`.

## Review Focus

1. A player whose only two snapshots share `captured_at` (two boards in one observation) must not produce a move; ordering must be deterministic — pinned in Task 4 (`order by captured_at, snapshot_id`, test "same instant, no move").
2. A player observed in alliance A on 580, then in an alliance with the same `external_id` on 581 where the 581 row does not exist in `alliances` yet: `relocated` must still be emitted under the 581 row only if it exists; with no row, nothing is listed and no error — Task 4 test "relocation to an unknown row is silent".
3. `alliance_info_latest` must not be masked by a newer `alliance.rank` snapshot that carries no intro — Task 3 test "a newer rank snapshot does not hide the info card".
4. Backfill must survive `raw` values of the wrong JSON type (`"joinApproval": "1"` as a string, `"powerRestrictionN": null`) — Task 3 regex-guarded casts, test "backfill tolerates string numbers".
5. The allies parser must not link a tag across servers (`565 RBRN` when RBRN exists only on 570) — Task 6 test "never matches across servers".

---

### Task 1: Confirm redaction applies only to fixture extraction

**Files:**
- Read: `services/collector/src/dw_collector/sanitize.py:135-150`, `cli.py:584-631`
- Write: `docs/superpowers/plans/2026-11-08-alliance-page-phase-a.md` (append the "Evidence" section below)

**Interfaces:** none. Produces a paragraph for the PR body.

- [ ] **Step 1:** Run
  ```
  grep -rn "sanitize\|SANITIZERS" services/collector/src/dw_collector --include=*.py | grep -v "^services/collector/src/dw_collector/sanitize.py"
  ```
  Expected: hits only in `cli.py` (the `extract-fixture` command, `SANITIZERS.get(command)` then `sanitizer(dict(matches[index].payload))`), and in `normalize/account_state.py`, `normalize/arena.py`, `protocol/army.py`, `protocol/worldmap.py` — open each of those four and confirm the word is a comment or an unrelated local name, not a call into `dw_collector.sanitize`.
- [ ] **Step 2:** Confirm `ingest.py`, `pipeline.py`, `storage/`, `sync/` contain no `sanitize` import. Record the grep output under "Evidence" in this plan.

### Task 2: Normalizer lifts the eight fields

**Files:**
- Modify: `services/collector/src/dw_collector/normalize/get_al_info.py`
- Test: `services/collector/tests/test_normalize_get_al_info.py`

**Interfaces:**
- Produces row keys on `alliance_snapshots`: `intro text|None`, `announce text|None`, `language text|None`, `join_approval int|None`, `min_power int|None`, `min_hq int|None`, `max_members int|None`, `country text|None`. Empty strings for `intro`/`announce` become `None`. `PARSER_VERSION = "1.1.0"`.

- [ ] **Step 1: Write the failing assertions** in `test_alliance_detail` (fixture `love_580_v1.json`):
  ```python
  assert row["intro"] == "[redacted intro]"
  assert row["announce"] is None  # payload has "" — an empty announcement is no announcement
  assert row["language"] == "391083"
  assert row["join_approval"] == 1  # raw payload integer; meaning unconfirmed
  assert row["min_power"] == 30000000
  assert row["min_hq"] == 20
  assert row["max_members"] == 100
  assert row["country"] == "TW"
  ```
  and in `test_minimal_payload`: all eight are `None`.
  Add `test_parser_version_bumped`: `assert get_al_info.PARSER_VERSION == "1.1.0"`.
- [ ] **Step 2:** `uv run pytest tests/test_normalize_get_al_info.py -q` → FAIL (KeyError `intro`).
- [ ] **Step 3:** Add to `_Payload`: `intro: str | None = None`, `announce: str | None = None`, `language: str | None = None`, `join_approval: int | None = Field(default=None, alias="joinApproval")`, `power_restriction: int | None = Field(default=None, alias="powerRestrictionN")`, `castle_restriction: int | None = Field(default=None, alias="castleRestrictionN")`, `max_member: int | None = Field(default=None, alias="maxMember")`, `country: str | None = None`. Add the eight row keys (`intro`/`announce` via `or None`). Bump version. Extend the module docstring: joinApproval meaning unconfirmed.
- [ ] **Step 4:** `uv run pytest tests/test_normalize_get_al_info.py -q` → PASS. Then `uv run pytest -q` whole suite (sync worker test asserts on this row).
- [ ] **Step 5:** `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
- [ ] **Step 6:** Commit `feat(collector): get.al.info lifts intro, rules and language`.

### Task 3: Migration 0309 — columns, backfill, `alliance_info_latest`

**Files:**
- Create: `supabase/migrations/20260728000309_alliance_info_fields.sql`
- Create: `supabase/tests/309_alliance_info_fields_test.sql`
- Modify: `packages/shared-types/src/database.types.ts` (alliance_snapshots Row/Insert/Update at ~1217; new view before `alliance_latest` at ~8733; new function after `alliance_membership_history` at ~10054)

**Interfaces:**
- Produces columns on `public.alliance_snapshots`: `intro text, announce text, language text, join_approval int, min_power bigint, min_hq int, max_members int, country text`.
- Produces `public.belongs_to_alliance(p_alliance uuid) returns boolean` — `language sql stable security invoker set search_path = ''`: `(select public.current_app_role()) = 'admin' or exists (select 1 from public.alliance_memberships m where m.user_id = (select auth.uid()) and m.alliance_id = p_alliance)`. (Own rows are readable under 0192's `own_or_manager_read`, so invoker is enough.) Reused by Task 4.
- Produces view `public.alliance_info_latest` columns: `snapshot_id, alliance_id, server_id, external_id, name, code, power, member_count, leader_game_uid, intro, announce, language, join_approval, min_power, min_hq, max_members, country, captured_at`. `distinct on (alliance_id)` over `alliance_snapshots where source_command = 'get.al.info'`, `order by alliance_id, captured_at desc`. `announce` is `case when public.belongs_to_alliance(s.alliance_id) then s.announce end`.

- [ ] **Step 1: Write the pgTAP file** (plan count fixed at the end). Fixtures: `collectors` row; alliances A `...a0a1` (580, own), B `...a0a2` (580, own), C `...a0a3` (581, not own); pin `is_own` after inserting (no rosters here, so set directly). auth.users + app_users: community `...a0f1` (`community`), memberA `...a0f2` (`member`, membership row in A), admin `...a0f3` (`admin`). `pg_temp.act_as(uuid)` as in test 111. Snapshots (`source_command = 'get.al.info'`) for A, B, C each with `intro`, `announce = 'secret-<x>'`, `language '391083'`, `join_approval 1`, `min_power 30000000`, `min_hq 20`, `max_members 100`, `country 'TW'`; a second, older A snapshot with `announce 'old'`; a newer A row with `source_command 'alliance.rank'` and null info fields.
  Assertions:
  - `has_column` × 8 on `alliance_snapshots`.
  - column comment on `join_approval` matches `%unconfirmed%` (`col_description`).
  - as community: `select announce from alliance_info_latest where alliance_id = A` is null; `intro` is `'intro-a'`; row count = 3.
  - as memberA: announce for A = `'secret-a'`; announce for B is null (own alliance the viewer is not in); announce for C is null.
  - as admin: announce for B = `'secret-b'`.
  - as memberA: `captured_at` for A equals the newest get.al.info row, and `intro` is `'intro-a'` (the newer alliance.rank row did not win).
  - `throws_ok` as `anon`: `select 1 from public.alliance_info_latest` → `42501`.
  - backfill: insert a get.al.info row with only `raw` = `{"intro":"x","joinApproval":"1","powerRestrictionN":null,"maxMember":100}` and null typed columns BEFORE the migration cannot run in pgTAP, so instead call the backfill as a function? No — keep the backfill inline; test it by re-running the same `update` statement text here is duplication. Instead: assert `(select count(*) from alliance_snapshots where raw ? 'intro' and intro is null) = 0` after inserting a row whose `intro` column is set by the test (sanity), and rely on the regex guard shape being identical to 0016's `backfill_month_card_from_raw`. Keep this test honest: name it "columns exist for the backfill to fill".
- [ ] **Step 2:** `pnpm db:test:local` → 309 fails (missing columns).
- [ ] **Step 3: Write the migration.** Header comment: why (spec), the raw-leak note (`raw` is already readable and carries `announce`; the typed column is what the page reads, the view gates it; closing `raw` is a separate decision). `alter table ... add column` × 8. Column comments: `join_approval` — "Raw joinApproval integer from get.al.info. Meaning UNCONFIRMED (fixture ADET: joinApproval 1, recruitTotal 1); check in the client before writing a sentence from it."; `min_power` ← `powerRestrictionN`; `min_hq` ← `castleRestrictionN`; `max_members` ← `maxMember`; `language` — "client localization key (391083 = Traditional Chinese); resolved in features/alliance/codes.ts"; `country` — ISO alpha-2. Backfill:
  ```sql
  update public.alliance_snapshots set
    intro        = nullif(raw ->> 'intro', ''),
    announce     = nullif(raw ->> 'announce', ''),
    language     = nullif(raw ->> 'language', ''),
    join_approval = case when raw ->> 'joinApproval' ~ '^-?\d+$' then (raw ->> 'joinApproval')::int end,
    min_power    = case when raw ->> 'powerRestrictionN' ~ '^-?\d+$' then (raw ->> 'powerRestrictionN')::bigint end,
    min_hq       = case when raw ->> 'castleRestrictionN' ~ '^-?\d+$' then (raw ->> 'castleRestrictionN')::int end,
    max_members  = case when raw ->> 'maxMember' ~ '^-?\d+$' then (raw ->> 'maxMember')::int end,
    country      = nullif(raw ->> 'country', '')
  where raw ?| array['intro','announce','language','joinApproval','powerRestrictionN','castleRestrictionN','maxMember','country'];
  ```
  Then `belongs_to_alliance`, the view, grants/revokes, comments.
- [ ] **Step 4:** `pnpm db:test:local` → all green (watch 0035's `alliance_latest` test still passes).
- [ ] **Step 5: Hand-edit types.** `alliance_snapshots` Row: add `announce: string | null`, `country`, `intro`, `join_approval: number | null`, `language`, `max_members`, `min_hq`, `min_power` in alphabetical position; Insert/Update with `?`. View `alliance_info_latest` before `alliance_latest` with all columns `| null`, `Relationships: []`. Function `belongs_to_alliance: { Args: { p_alliance: string }; Returns: boolean }` between `backfill_month_card_from_raw` and `boss_damage_by_event`.
- [ ] **Step 6:** `pnpm typecheck`. Commit `feat(db): promote get.al.info fields and gate announce per alliance (0309)`.

### Task 4: Migration 0310 — `alliance_moves`

**Files:**
- Create: `supabase/migrations/20260728000310_alliance_moves.sql`
- Create: `supabase/tests/310_alliance_moves_test.sql`
- Modify: `packages/shared-types/src/database.types.ts` (function after `alliance_membership_history`)

**Interfaces:**
- Consumes `public.belongs_to_alliance(uuid)` from Task 3.
- Produces index `player_snapshots_server_alliance_player_idx on public.player_snapshots (server_id, alliance_external_id, player_id) where alliance_external_id is not null`.
- Produces `public.alliance_moves(p_alliance uuid, p_since timestamptz default now() - interval '90 days') returns table (player_id uuid, game_uid bigint, player_name text, direction text, other_alliance_id uuid, other_alliance_tag text, other_alliance_name text, other_server_id int, power_at bigint, observed_at timestamptz)`, `language sql stable security invoker set search_path = ''`, ordered `observed_at desc, game_uid`.

Algorithm (the signature does not determine it):
```
target  := alliances row p_alliance (server_id S, external_id X)
visible := not target.is_own
        or public.belongs_to_alliance(p_alliance)
touching := distinct player_id from player_snapshots where alliance_external_id = X   -- any server (relocation)
hist    := touching players' snapshots with captured_at >= p_since
        union all newest snapshot per touching player with captured_at < p_since
steps   := hist with lag(server_id), lag(alliance_external_id) over (partition by player_id order by captured_at, snapshot_id)
row where prev exists and captured_at >= p_since and:
  in        : (server_id, alliance_external_id) = (S, X) and prev.alliance_external_id is distinct from X
  out       : (prev.server_id, prev.alliance_external_id) = (S, X) and alliance_external_id is distinct from X
  relocated : (server_id, alliance_external_id) = (S, X) and prev.alliance_external_id = X and prev.server_id <> S
other := the alliances row for (prev.server_id, prev.alliance_external_id) on in/relocated, (server_id, alliance_external_id) on out; left joined, so unknown gives null id/tag/name; other_server_id is that observation's server_id when its alliance_external_id is not null, else null
power_at := the moving row's power; observed_at := its captured_at; player_name := players.current_name
```
`alliance_external_id is distinct from X` with prev X on the same server is excluded from `in` by the equality on both parts; a same-X different-server prev is the relocation branch and never `out`.

- [ ] **Step 1: Write the pgTAP file.** Servers 580/581 are seeded. Alliances: A `(580,'ext-a')` own, B `(580,'ext-b')` own, C `(581,'ext-c')` not own, D `(581,'ext-a')` not own (A relocated). Users as in Task 3 plus officerA (membership role `officer` in A). Players p1..p8 with `player_snapshots` rows (`source_command 'server.rank'`, `power`, `captured_at`):
  - p1: t1 null alliance (580), t2 `ext-a` (580) → `in` for A, other all null, `power_at` = t2 power.
  - p2: t1 `ext-a` (580), t2 `ext-c` (581) → `out` for A with `other_alliance_tag 'CCC'`, `other_server_id 581`; `in` for C with other tag `'AAA'`, server 580.
  - p3: t1 `ext-c` (581), t2 `ext-a` (580) → `in` for A, other tag `'CCC'`.
  - p4: t1 `ext-a` (580), t2 `ext-a` (581) → `relocated` for D with other tag `'AAA'`, other_server 580; zero rows for A.
  - p5: one row in `ext-a` → nothing.
  - p6: t1, t2 both `ext-a` (580) → nothing.
  - p7: two rows at the same `captured_at`, one `ext-a` one null, same observation → nothing (ordering by snapshot_id; assert count of p7 rows is 0 for the direction that would flip-flop: `count(*) where game_uid = p7` ≤ 1 — assert exactly 0 by giving both rows `ext-a`; the "same instant" case is covered as: the row count for p7 is 0).
  - p8: t1 `ext-a` (580), t2 `ext-a` (582) with no alliances row for (582,'ext-a') → no row anywhere, no error.
  - since: p1's t2 at `now() - interval '100 days'`; calling with default `p_since` omits it, calling with `'2000-01-01'` includes it.
  Visibility (each under `set local role authenticated` + `act_as`): community → A: `is_empty`; memberA → B: `is_empty`; community → C: `isnt_empty`; memberA → A: 3 rows (p2 out, p3 in, and with far since p1 in); officerA → A: `isnt_empty`; admin → B: callable (empty set, no error: `lives_ok`). `throws_ok` as anon → `42501`. `has_index`.
- [ ] **Step 2:** `pnpm db:test:local` → 310 fails (function missing).
- [ ] **Step 3: Write the migration** with the algorithm above, index, grants (`revoke all ... from public, anon; grant execute ... to authenticated, service_role`), comments (visibility rule, coverage caveat, relocation rule).
- [ ] **Step 4:** `pnpm db:test:local` → green.
- [ ] **Step 5:** Types: `alliance_moves: { Args: { p_alliance: string; p_since?: string }; Returns: {...}[] }` with the ten columns alphabetical, non-null typed (generator style for `returns table`).
- [ ] **Step 6:** `pnpm typecheck`. Commit `feat(db): alliance_moves feed over player_snapshots (0310)`.

### Task 5: `codes.ts` — language keys and country codes

**Files:**
- Create: `apps/dashboard/src/features/alliance/codes.ts`, `codes.test.ts`

**Interfaces:**
- `export interface CodeName { en: string; ko: string }`
- `export const LANGUAGES: Readonly<Record<string, CodeName>>` — keys `390751`..`390783` (as the client dictionary has them, gaps included) and `391083`, from `C:\DW_data\gamedata\extracted\datatable_langslice_localization_dialog_1\Assets_Main_DataTable_Localization_{English,Korean}_Dictionaries_Dialog_1.txt`.
- `export const COUNTRIES: Readonly<Record<string, CodeName>>` — ISO 3166-1 alpha-2, English + Korean; a partial list of the countries seen in the game's regions is acceptable and the fallback covers the rest.
- `export function languageName(key: string | null): string | null` — English name, else the raw key, null for null.
- `export function countryName(code: string | null): string | null` — same shape, uppercases the code.

- [ ] **Step 1:** Tests: `languageName('391083') === 'Traditional Chinese'`, `languageName('390758') === 'Korean'`, `languageName('999999') === '999999'`, `languageName(null) === null`; `countryName('TW') === 'Taiwan'`, `countryName('tw') === 'Taiwan'`, `countryName('ZZ') === 'ZZ'`; `LANGUAGES['391083'].ko === '중국어 (번체)'`.
- [ ] **Step 2:** `pnpm --filter dashboard test -- codes` → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `feat(alliance): language and country code names`.

### Task 6: `allies.ts` — intro parser

**Files:**
- Create: `apps/dashboard/src/features/alliance/allies.ts`, `allies.test.ts`

**Interfaces:**
- `export interface KnownAlliance { allianceId: string; serverId: number; code: string }`
- `export type IntroSegment = { kind: 'text'; text: string } | { kind: 'ally'; serverId: number; tag: string; allianceId: string | null }`
- `export function parseIntro(text: string, known: readonly KnownAlliance[]): IntroSegment[][]` — one array per input line (split on `\n`, `\r\n`); a line is parsed into ally groups only when the WHOLE line is groups separated by `/` (optional spaces), each group `^\d{3}\s+TAG(\s+TAG)*$`, `TAG = [A-Za-z0-9]{2,6}`; otherwise the line is one text segment. Separator text (` / `, spaces, the server number) is kept as text segments so the rendering reproduces the line. Tag match is case-insensitive on `code`, within `serverId` only. Unknown tag → `allianceId: null`.

- [ ] **Step 1:** Tests (known: RBRN@565, SYNN@570, SYN2@570, RBRN@570 with a different id): "slash-separated line" `565 RBRN / 570 SYNN SYN2 RYSE` → allies RBRN(565 id), SYNN, SYN2, RYSE(null), text segments between; "newline-separated"; "no-match line stays text"; "never matches across servers" — `565 RBRN` resolves to the 565 row, not the 570 one, and `571 SYNN` gives null; "lowercase tag matches"; "empty text gives []".
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `feat(alliance): parse allied tags out of the intro text`.

### Task 7: `verdict.ts`

**Files:**
- Create: `apps/dashboard/src/features/alliance/verdict.ts`, `verdict.test.ts`

**Interfaces:**
- `export interface Neighbour { tag: string | null; power: number | null }`
- `export interface AllianceVerdictFacts { rank: number | null; total: number | null; serverId: number | null; power: number | null; above: Neighbour | null; below: Neighbour | null; joinRule: 'approval' | 'open' | null; minPower: number | null; minHq: number | null }`
- `export function composeAllianceVerdict(facts: AllianceVerdictFacts): string`
- `export function standingFacts(rows: readonly { alliance_id: string | null; power: number | null; code: string | null }[], allianceId: string): Pick<AllianceVerdictFacts, 'rank' | 'total' | 'power' | 'above' | 'below'>` — rows are one server's `alliance_latest`; rank by power desc, nulls last; absent alliance → all null.
- Figures via `compactNumber(1).format`. Copy: `#{rank} of {total} alliances on {server}` + (`, {lead} ahead of [{tag}].` when rank is 1 and below has power; `, {gap} behind [{tag}].` when above has power; else `.`). Second sentence: `Joins need approval` / `Open join`, then ` · ` and minimums `{minPower} and HQ {minHq} minimum.` (either half alone when the other is null). `joinRule` null → minimums sentence alone (`{minPower} and HQ {minHq} minimum.`). All-null facts → `''`.

- [ ] **Step 1:** Tests: leader with lead; second place with gap; rank with no neighbour power → sentence ends after server; join approval + both minimums; minimums only; HQ only; nothing → `''`; `standingFacts` on three rows gives rank 2 with above/below; null power sorts last.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit `feat(alliance): verdict sentence from standing and join rules`.

### Task 8: Query modules

**Files:**
- Create: `apps/dashboard/src/features/alliance/info.ts`, `moves.ts`, `moves.test.ts`

**Interfaces:**
- `info.ts`: `export type AllianceInfo = Database['public']['Views']['alliance_info_latest']['Row']`; `export async function fetchAllianceInfo(allianceId: string): Promise<AllianceInfo | null>` (`maybeSingle`, throws on error); `export function joinRuleOf(info): 'approval' | 'open' | null` returns null always for now with a comment pointing at the column comment (the one place to flip once confirmed).
- `moves.ts`: `export type AllianceMove = Database['public']['Functions']['alliance_moves']['Returns'][number]`; `export type MoveDirection = 'in' | 'out' | 'relocated'`; `export const MOVES_WINDOW_DAYS = 90`; `export async function fetchAllianceMoves(allianceId: string, since: Date): Promise<AllianceMove[]>`; `export function otherAllianceLabel(move: AllianceMove): string` → `[TAG] on 571`, `on 571` when tag null but server known, `no alliance` when both null; `export function filterMoves(rows, direction: MoveDirection | 'all'): AllianceMove[]`; `export function newestMoves(rows, limit): AllianceMove[]` (sorted by observed_at desc).
- Supabase client: `import { supabase } from '../../lib/supabase'`.

- [ ] **Step 1:** Tests for `otherAllianceLabel` (three cases), `filterMoves`, `newestMoves` ordering and limit.
- [ ] **Step 2–5:** FAIL, implement, PASS, `pnpm check && pnpm typecheck && pnpm test`, commit `feat(alliance): info and moves query modules for phase B`.

### Task 9: Gates, push, PR

- [ ] `pnpm check && pnpm typecheck && pnpm test && pnpm build`; `pnpm db:test:local`; collector gates.
- [ ] `git fetch origin main && bash scripts/check-migration-order.sh`.
- [ ] Push `alliance-page-moves-57cdca`; `gh pr create --draft --title "feat(alliance): info fields and moves feed (phase A)"` with body: redaction evidence (Task 1), the `join_approval` int decision, the `raw` leak note, the view's `source_command` filter, phase B consumption list (`alliance_info_latest` columns, `alliance_moves` args/columns, `composeAllianceVerdict`, `standingFacts`, `parseIntro`, `languageName`, `countryName`, `fetchAllianceInfo`, `fetchAllianceMoves`, `otherAllianceLabel`, `filterMoves`, `newestMoves`), and what CI must confirm (types diff, pgTAP under real `supabase test db`).

## Evidence (Task 1)

`dw_collector.sanitize` is imported in exactly one place: `cli.py:593`, a
local import inside the `extract-fixture` command, whose result is written to
a fixture file (`cli.py:630`, `payload=sanitizer(...)`). `ingest.py`,
`pipeline.py`, `storage/` and `sync/` contain no `sanitize` import. The other
grep hits (`normalize/account_state.py:120`, `normalize/arena.py:52`,
`protocol/army.py:345`, `protocol/worldmap.py:457,508`) are comments. The
collector stores `intro` and `announce` verbatim; redaction is fixture-only.
