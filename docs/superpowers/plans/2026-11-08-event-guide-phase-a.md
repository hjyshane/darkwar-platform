# Event Guide Framework — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The data model, generalised importer, section schemas and pure derivations the event guide's editor and reading page (phase B) will sit on.

**Architecture:** Three new tables (`event_guides`, `event_guide_sections`, `game_event_score_items`) beside the 0248 score tables, read by every role that reads `game_event_scores`, written through the 0078 `guide.*` capabilities. The collector's `gamedata/event_guide.py` stops filtering to two activity ids and additionally writes one `client` `point_table` section per theme under an auto-created unpublished guide per activity. The dashboard side is pure TypeScript only: payload validators per section kind, `item_ref` resolution, `bestDays`, the score-item overlay, and the prep derivation over the planner's stock shape.

**Tech Stack:** PostgreSQL 17 / pgTAP, Python 3.12 (httpx, sqlite3, typer), TypeScript (vitest, biome), hand-edited `packages/shared-types/src/database.types.ts`.

**Spec:** `docs/superpowers/specs/2026-11-08-event-guide-framework-design.md`

## Global Constraints

- Migration number is the next after `origin/main`'s highest AT PUSH; run `scripts/check-migration-order.sh` before pushing. Working number in this plan: `0309`.
- `pnpm db:test:local` before pushing a migration; no Docker on this machine.
- Hosted traps: `revoke all ... from anon, authenticated` then explicit grants; new functions `revoke all on function ... from public, anon`.
- No `zod`; validators are hand-written `parseX(value: unknown): X | null` like `lib/seasonLab.ts`.
- English UI; `*_ko` columns are optional data only.
- Diff confined to `apps/dashboard/src/features/eventGuide/**`, `services/collector/src/dw_collector/gamedata/event_guide.py`, `services/collector/src/dw_collector/cli.py` (the one command), `services/collector/tests/test_event_guide.py`, the migration, its pgTAP file, `database.types.ts`, and `docs/runbooks/game-data.md`.
- `database.types.ts` is hand-edited: alphabetical placement, `Relationships: []` on one line when empty, `auth.users` FK shows as `pending_access` / `["user_id"]`.
- Importer never writes `game_event_score_items`, never touches a section whose `source = 'officer'`, never overwrites an existing `event_guides` row.

## Review Focus

1. A `hero.event.info.get` whose `score` is a threshold, not an id list (activity 100003: `score: '90272'`) → zero score rows → NO guide and NO section for that activity; it is reported, not written. (Task 6 test.)
2. A `get.hero.event.calendar` capture carries no `activityId`; its day/slot rows attach to the activity whose theme owns the `eventId`, and an eventId no theme claims is dropped. (Task 6 test.)
3. A `point_table` row whose `points` is 0 or `per` is 0 must not divide by zero in `bestDays`. (Task 3 test.)
4. Stock that lacks the item entirely is `held: null`, not 0 → `points: null`; a cap smaller than held clamps. (Task 5 test.)
5. A section payload with the right shape but wrong `kind` string, or a row with a non-numeric `points`, parses to `null`, never to a half-filled object. (Task 2 test.)

---

### Task 1: Migration 0309, pgTAP 309, generated types

**Files:**
- Create: `supabase/migrations/20260728000309_event_guides.sql`
- Create: `supabase/tests/309_event_guides_test.sql`
- Modify: `packages/shared-types/src/database.types.ts`

**Interfaces:**
- Produces tables:
  - `event_guides(guide_id uuid pk default gen_random_uuid(), activity_id text unique check ~'^[0-9]+$', slug text not null unique check length 1..80, title text not null check length 1..120, title_ko text, summary text, summary_ko text, starts_rule jsonb not null default '{}' check object, published boolean not null default false, post_id uuid references guides(guide_id) on delete set null, updated_by uuid references auth.users(id) on delete set null default auth.uid(), updated_at timestamptz not null default now())`
  - `event_guide_sections(section_id uuid pk, guide_id uuid not null references event_guides on delete cascade, kind text not null check in ('rewards','stages','point_table','prep','sources','notes'), title text, title_ko text, sort_order int not null default 0, source text not null default 'officer' check in ('client','officer'), payload jsonb not null default '{}' check object, updated_by, updated_at)` with index `(guide_id, sort_order)`.
  - `game_event_score_items(score_id text pk check ~'^[0-9]+$', item_ref jsonb not null check object, per numeric not null default 1 check > 0, updated_by, updated_at)`.
- Function `public.event_guide_stamp()` returns trigger: `new.updated_at := now(); if auth.uid() is not null then new.updated_by := auth.uid(); end if;` — `before update` on all three; `revoke all on function public.event_guide_stamp() from public, anon`.
- Policies on each table: `member_read` select `using ((select public.current_app_role()) in ('member', 'community', 'officer', 'admin'))`; `writer_insert` with check `public.has_permission('guide.write')`; `writer_update` using/with check `public.has_permission('guide.edit')`; `writer_delete` using `public.has_permission('guide.delete')`.
- Grants: `revoke all ... from anon, authenticated; grant select, insert, update, delete ... to authenticated; grant all ... to service_role`.
- Comments on the three tables citing 0309 and `dw-collector game-event-guide`.

- [ ] **Step 1: Write the failing pgTAP file** `supabase/tests/309_event_guides_test.sql` — `plan(16)`. Fixture: four `auth.users` + `app_users` (admin, officer, member, community) with ids `...0309` suffix pattern as 46_guides_test does; `pg_temp.act_as`. As the migration owner, insert one guide (`slug 'halloween-2026', title 'Halloween', activity_id '100099'`) and one officer section. Assertions:
  1. `set local role service_role` → `lives_ok` insert guide `activity_id '100004'`, insert `client` section under it ("the importer's service-role path writes").
  2. member: `isnt_empty` select from `event_guides` (2 rows); `throws_ok` insert guide `42501`; `throws_ok` insert section `42501`; `throws_ok` insert `game_event_score_items` `42501`.
  3. community: `isnt_empty` select `event_guide_sections`; `isnt_empty` select `game_event_score_items` after officer writes one (order the test so the row exists first) — or assert `is(count, 0)` and `lives_ok` on select; `throws_ok` insert guide `42501`.
  4. officer: `lives_ok` insert guide; `lives_ok` update `event_guides set title` on the Halloween row; `lives_ok` insert `game_event_score_items ('1000020101', '{"kind":"item","id":"253042"}', 1)`; delete the Halloween guide then `is(count where slug='halloween-2026', 1)` ("cannot delete — the irreversible verb keeps the narrower role").
  5. admin: `lives_ok` delete the Halloween guide; `is(count sections for that guide, 0)` (cascade).
  6. structure: `is((select count(*) from pg_policies where cmd='SELECT' and qual like '%community%' and tablename in (the three)), 3)`; `is((select count(*) from information_schema.role_table_grants where grantee='anon' and table_name in (the three)), 0)`.
  7. `throws_ok` insert section with `kind 'prose'` → `23514`.
- [ ] **Step 2: Run it to see it fail** — `pnpm db:test:local` (or `python scripts/pgtap/run.py` with the file filter it supports; read `scripts/pgtap/run.py --help`). Expected: 309 fails on missing relation.
- [ ] **Step 3: Write the migration** per Interfaces. Header comment: why separate from the 0078 board, that the importer creates guides unpublished, and that `game_event_score_items` is officer-owned.
- [ ] **Step 4: Run `pnpm db:test:local`** — Expected: all files pass, 309 included.
- [ ] **Step 5: Hand-edit `database.types.ts`.** Insert `event_guide_sections` and `event_guides` before `event_names` (after `event_attendance`); `game_event_score_items` before `game_event_scores`. Relationships: `event_guide_sections_guide_id_fkey → event_guides(guide_id)`, `event_guide_sections_updated_by_fkey → pending_access(user_id)`; `event_guides_post_id_fkey → guides(guide_id)`, `event_guides_updated_by_fkey → pending_access(user_id)`; `game_event_score_items_updated_by_fkey → pending_access(user_id)`. Check whether trigger functions appear in the `Functions` block (grep `guides_set_actor`); they do not, so `event_guide_stamp` is not added. Numeric `per` is `number`.
- [ ] **Step 6: `pnpm typecheck`** — Expected: pass.
- [ ] **Step 7: Commit** — `feat(db): event_guides, event_guide_sections, game_event_score_items (0309)`.

### Task 2: Section schemas, fixtures, item_ref helpers

**Files:**
- Create: `apps/dashboard/src/features/eventGuide/sections/common.ts`
- Create: `apps/dashboard/src/features/eventGuide/sections/itemRef.ts`
- Create: `apps/dashboard/src/features/eventGuide/sections/rewards.ts`, `stages.ts`, `pointTable.ts`, `prep.ts`, `sources.ts`, `notes.ts`
- Create: `apps/dashboard/src/features/eventGuide/sections/index.ts`
- Create: `apps/dashboard/src/features/eventGuide/sections/fixtures.ts`
- Test: `apps/dashboard/src/features/eventGuide/sections/sections.test.ts`, `itemRef.test.ts`

**Interfaces (produces):**
- `common.ts`: `isRecord(v): v is Record<string, unknown>`, `str(v): string | null` (non-empty string), `optStr(v): string | undefined`, `num(v): number | null` (finite), `optNum`, `intIn(v, lo, hi): number | null`, `list<T>(v, parse: (x: unknown) => T | null): T[] | null` (null if any element fails). `SECTION_KINDS = ['rewards','stages','point_table','prep','sources','notes'] as const`; `type SectionKind`.
- `itemRef.ts`: `ITEM_REF_KINDS = ['item','resource','hero','gear','exclusive','pet'] as const`; `interface ItemRef { kind: ItemRefKind; id: string }`; `parseItemRef(v: unknown): ItemRef | null`; `itemRefKey(ref): string` = `${kind}:${id}`; `interface ItemCatalogue { names: Map<string, string>; icons: Map<string, string> }` keyed by `itemRefKey`; `catalogueFrom(input: { items?: {item_id: string; name: string | null}[]; resources?: {resource_id: number; name: string | null}[]; heroes?: {hero_id: number; name: string | null}[]; iconRefs?: {kind: string; ref_id: string; icon_key: string}[] }): ItemCatalogue` (icon_ref kinds map 1:1 to item_ref kinds); `resolveItemRef(ref, catalogue): { ref: ItemRef; label: string; iconKey: string | null }` with fallback label `"item 253042"`.
- Each kind file exports the TS type and `parse<Kind>(payload: unknown): <Kind> | null`:
  - `RewardsPayload { items: { item_ref: ItemRef | null; label: string; kind: string; how: string; icon_ref?: string }[] }`
  - `StagesPayload { groups: { label: string; stages: { n: number; drops: { item_ref: ItemRef; qty: number }[] }[] }[]; totals: { item_ref: ItemRef; qty: number }[] }`
  - `PointTablePayload { day: number | null; theme: string | null; rows: { action: string; points: number; score_id?: string; item_ref?: ItemRef; per?: number; best_day_hint?: string }[] }`
  - `PrepPayload { items: { item_ref: ItemRef; unit: number; per_unit_points?: number; per_unit_shots?: number; cap?: number; day?: number }[] }` (`unit` = stock units per scored unit, default 1)
  - `SourcesPayload { rows: { source: string; rate: string; cap: number | null }[]; total_cap: number | null; note: string | null }`
  - `NotesPayload { text: string; text_ko: string | null }`
- `index.ts`: `type SectionPayload = { kind: 'rewards'; payload: RewardsPayload } | ...`; `parseSection(kind: string, payload: unknown): SectionPayload | null`; `interface GuideSection { section_id: string; guide_id: string; kind: string; title: string | null; sort_order: number; source: 'client' | 'officer'; payload: unknown }`; `parseSections(rows: GuideSection[]): ParsedSection[]` where `ParsedSection = GuideSection & SectionPayload` and unparsable rows are dropped.
- `fixtures.ts` (Halloween, from the spec's examples): `HALLOWEEN_REWARDS` (skin, title, emoji, frame), `HALLOWEEN_STAGES` (2 groups × 3 stages, totals), `HALLOWEEN_POINT_TABLES` — six days; `item:253042` (orange hero shard) appears day 2 at 750, days 5 and 6 at 500, `item:200036` only on day 1, `resource:25` on days 1 and 3 at 10 and 10 (a tie); `HALLOWEEN_PREP` (shard `unit 1, per_unit_points 750, cap 412, day 2`; ammo `per_unit_shots 1, cap 300`); `HALLOWEEN_SOURCES`; `HALLOWEEN_NOTES`.

- [ ] **Step 1: Write failing tests** `sections.test.ts`: for each kind, `parse<Kind>(FIXTURE)` deep-equals the fixture; `parseSection('point_table', HALLOWEEN_POINT_TABLES[1])` has `kind 'point_table'`; `parseSection('prose', {})` is null; `parsePointTable({day: 2, rows: [{action: 'x', points: 'many'}]})` is null (Review Focus 5); `parseStages({groups: 'nope'})` is null. `itemRef.test.ts`: `parseItemRef({kind:'item', id: 253042})` → `{kind:'item', id:'253042'}` (numbers coerced); unknown kind → null; `resolveItemRef` returns the catalogue name and icon key, and the fallback label when absent.
- [ ] **Step 2: Run** `pnpm --filter @dw/dashboard test -- sections` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the files per Interfaces.
- [ ] **Step 4: Run** same command — Expected: PASS. `pnpm check` clean.
- [ ] **Step 5: Commit** — `feat(dashboard): event guide section schemas and item_ref resolution`.

### Task 3: `bestDays`

**Files:**
- Create: `apps/dashboard/src/features/eventGuide/bestDays.ts`
- Test: `apps/dashboard/src/features/eventGuide/bestDays.test.ts`

**Interfaces:**
- Consumes `PointTablePayload`, `itemRefKey` (Task 2).
- Produces: `interface BestDay { days: number[]; points: number }`; `bestDays(tables: readonly PointTablePayload[]): Map<string, BestDay>` keyed by `itemRefKey`. Per unit: `points / (per ?? 1)`; a row with `per <= 0` or no `item_ref` or a table with `day === null` is skipped; an item seen on fewer than two distinct days is absent; ties list every day ascending.

- [ ] **Step 1: Failing tests**: shard → `{days: [2], points: 750}`; `resource:25` → `{days: [1, 3], points: 10}`; `item:200036` absent; a table with `rows: [{action, points: 100, item_ref, per: 0}]` is skipped (Review Focus 3); an item listed twice on the same day in two tables counts as one day.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** `feat(dashboard): bestDays over point tables`.

### Task 4: Score-item overlay

**Files:**
- Create: `apps/dashboard/src/features/eventGuide/scoreItems.ts`
- Test: `apps/dashboard/src/features/eventGuide/scoreItems.test.ts`

**Interfaces:**
- Produces: `interface ScoreItem { item_ref: ItemRef; per: number }`; `type ScoreItemMap = Map<string, ScoreItem>`; `scoreItemMapFrom(rows: readonly { score_id: string; item_ref: unknown; per: number | null }[]): ScoreItemMap` (rows whose `item_ref` fails `parseItemRef` are dropped); `mergeScoreItems(table: PointTablePayload, map: ScoreItemMap): PointTablePayload` — a row with no `item_ref` and a `score_id` in the map gets the map's `item_ref` and `per`; a row that already has `item_ref` is untouched; the input is not mutated.

- [ ] **Step 1: Failing tests**: client row `{action, points: 300, score_id: '1000020101'}` + map → row gains `item_ref` and `per 1`; an officer row keeps its own `item_ref` even when the map disagrees; unknown `score_id` stays bare; original table object unchanged (`toEqual` snapshot before/after).
- [ ] **Steps 2–5** as Task 3; commit `feat(dashboard): overlay game_event_score_items onto client point tables`.

### Task 5: Prep derivation

**Files:**
- Create: `apps/dashboard/src/features/eventGuide/prepCheck.ts`
- Test: `apps/dashboard/src/features/eventGuide/prepCheck.test.ts`

**Interfaces:**
- Consumes `PrepPayload` (Task 2), `Account` from `features/planner/accounts.ts` (type import only).
- Produces: `type Stock = Pick<Account, 'items' | 'resources'>`; `interface PrepLine { item: PrepPayload['items'][number]; held: number | null; counted: number | null; points: number | null; shots: number | null }`; `derivePrep(prep: PrepPayload, stock: Stock | null): PrepLine[]`. `held` = `stock.items[id]` for kind `item`, `stock.resources[id]` for `resource`, else null; null stock → every `held` null. `counted = min(floor(held / unit), cap ?? ∞)`; `points = per_unit_points === undefined ? null : counted * per_unit_points`; `shots` likewise with `per_unit_shots`.

- [ ] **Step 1: Failing tests**: shard held 412, `per_unit_points 750, cap 412` → `points 309000`; held 500 with cap 412 → counted 412; stock missing the key → `held null, points null` (Review Focus 4); `unit 10`, held 95 → counted 9; null stock → all null; ammo line → `shots` set, `points null`.
- [ ] **Steps 2–5**; commit `feat(dashboard): prep derivation over the planner's stock`.

### Task 6: Generalised importer

**Files:**
- Modify: `services/collector/src/dw_collector/gamedata/event_guide.py`
- Modify: `services/collector/src/dw_collector/cli.py:1229-1277` (the `game-event-guide` command only)
- Test: `services/collector/tests/test_event_guide.py`

**Interfaces:**
- `Guide` gains `guides: list[dict]`, `sections: list[dict]`, `activities: list[str]` (every activity id seen), `unnamed: list[str]` (activity ids with scores but no client name), `scoreless: list[str]` (activity ids seen with no score row).
- `build_from(english, korean, score_table, observations, names: Mapping[str, str] | None = None) -> Guide` — `names` is `activity_id → title` (from `names.event_names(assets)` `.name` in `build`). Two passes: themes/scores from every `hero.event.info.get` with a non-empty `activityId`; then calendar rows whose `eventId` matches a theme take that theme's `activity_id`, else dropped.
- A guide row per activity WITH ≥1 score row: `{"activity_id", "slug": f"activity-{id}", "title": names.get(id) or f"Activity {id}", "published": False}`.
- A section row per theme with ≥1 score row: `{"activity_id", "kind": "point_table", "source": "client", "title": theme name, "sort_order": theme.day or index, "payload": {"day": theme.day, "theme": name, "rows": [{"score_id", "action": actionText-ish raw action, "points", "per": per_value}]}}` ordered by `sort_order`. (`guide_id` is attached at write time.)
- `write_guides(client: httpx.Client, guide: Guide) -> tuple[int, int]` → (guides inserted, sections written): POST `/rest/v1/event_guides` with `Prefer: resolution=ignore-duplicates,return=minimal` and `on_conflict=activity_id`; GET `event_guides?select=guide_id,activity_id&activity_id=in.(...)`; DELETE `event_guide_sections?guide_id=in.(...)&source=eq.client`; POST sections in `upload.BATCH` batches.
- `dry_run_report(guide: Guide) -> str` returns one line: `activities=N themes=N scores=N calendar=N guides=N sections=N scoreless=[...] unnamed=[...]`.
- `read_journal` unchanged.
- CLI: docstring updated; prints `dry_run_report`; after the three existing upserts calls `write_guides` and echoes `guides=+N sections=N`.

- [ ] **Step 1: Failing tests** (keep the seven existing ones; `test_other_activities_and_other_commands_are_ignored` becomes `..._other_commands_are_ignored_and_other_activities_are_kept`). New: `ACTIVITIES` import fails (removed); `build_from` with PREPAREDNESS, DUEL and `THRESHOLD = ("hero.event.info.get", {"activityId": "100003", "eventList": [{"eventId": "10000307", "score": "90272"}]})` → `activities == ['100003','100004','70005']`, `scoreless == ['100003']`, guides for 100004 and 70005 only, `unnamed == ['70005']` when `names={'100004': 'Survival Preparedness'}`; the Duel section has `day 4`, `payload.rows[0].score_id == '441000'`, `per == 100`; calendar rows resolve to `activity_id '100004'` via the theme and an unknown `eventId '99'` is dropped; a journal fixture: write `raw_observations` (`observation_id, collector_id, source_command, captured_at, collected_from_server_id, payload_json, created_at`) into `tmp_path / 'journal.db'` with the three payloads and one `get.something.else`, then `read_journal` → `build_from` gives the same guides. `write_guides` with `httpx.MockTransport`: records requests; asserts the guides POST has `Prefer` containing `ignore-duplicates`, the DELETE URL contains `source=eq.client`, and the section rows carry the `guide_id` the GET returned.
- [ ] **Step 2: Run** `uv run pytest tests/test_event_guide.py -q` from `services/collector` — FAIL.
- [ ] **Step 3: Implement** per Interfaces; keep the module under 400 lines (move write helpers to the bottom; no new module unless it crosses 400).
- [ ] **Step 4: Run** pytest file, then `uv run ruff check . && uv run ruff format --check . && uv run mypy src` — PASS.
- [ ] **Step 5: Commit** — `feat(collector): game-event-guide imports every activity the journal has seen`.

### Task 7: Runbook and the real dry run

**Files:**
- Modify: `docs/runbooks/game-data.md` section `## 이벤트 가이드: 무엇이 점수를 주는가 (0248)`

- [ ] **Step 1: Run the real dry run** from `services/collector` (worktree `.venv`; if `uv run --no-sync` cannot find the package there, run `uv sync --extra gamedata` once in the worktree first): `uv run --no-sync --with "UnityPy>=1.25" --with "lupa>=2.8" dw-collector game-event-guide --bundles C:/DW_data/gamedata/base --bundles C:/DW_data/gamedata/bundles --journal C:/DW_data/live.db --dry-run`. Keep the count line for the PR.
- [ ] **Step 2: Rewrite the section** (Korean, same voice): what the importer now covers (every activity in the journal), the per-theme `point_table` sections and unpublished guides (0309), what it never touches (officer sections, `game_event_score_items`), the dry-run line and its fields, and the step when `unnamed` lists ids (`game-names` first, or an officer renames the guide). Replace the 2026-10-12 counts with today's.
- [ ] **Step 3: Commit** — `docs(runbooks): event guide importer covers every journaled activity`.

### Task 8: Gate, push, draft PR

- [ ] **Step 1:** `pnpm check && pnpm typecheck && pnpm test && pnpm db:test:local` — all green.
- [ ] **Step 2:** in `services/collector`: `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest` — all green.
- [ ] **Step 3:** `git fetch origin main && scripts/check-migration-order.sh` — renumber migration + test + comments if it fails.
- [ ] **Step 4:** push; `gh pr create --draft --title "feat(event-guide): guide model and generalised importer (phase A)"` body: what phase B consumes (tables and policies; `parseSections`, `catalogueFrom`/`resolveItemRef`, `bestDays`, `scoreItemMapFrom`/`mergeScoreItems`, `derivePrep`; section row shape the importer writes), the dry-run line, the 100003 finding, and what is NOT done (editor, reading page, legacy tab migration, `--dry-run` was run but no write).
