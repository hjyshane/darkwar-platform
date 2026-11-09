# Calculator reference mode — phase A implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data and pure modules the `#/calculator` page (phase B) will consume: chip upgrade steps, the `counter` cost type, the season-building filter, URL state, the planner hand-off, and bilingual subject search.

**Architecture:** The importer (`gamedata/catalog.py`) gains a `chip` kind read from `car_microchip_promote` and tags building steps with the client's `building_season`. One migration widens `costs`, adds the two nullable columns, and exposes `game_season` on the subjects view. The planner's pure `plan.ts` learns the `counter` cost type; new pure modules under `features/calculator/` hold URL, hand-off, chip labels, season grouping and search. No page is built.

**Tech Stack:** Python 3.12 (uv, lupa/UnityPy for the client tables), PostgreSQL migrations + pgTAP, TypeScript/Vitest in the Vite dashboard.

**Spec:** `docs/superpowers/specs/2026-11-08-calculator-reference-design.md`

## Global Constraints

- Migration number is taken from `origin/main` at push (highest now 0308 → 0309); `scripts/check-migration-order.sh` before pushing.
- `pnpm db:test:local` before pushing the migration (no Docker here).
- Existing planner tests stay untouched and green.
- No raw game data committed; the Python fixture is a hand-written Lua table.
- Collector Python edited and committed in this worktree.
- New kinds inherit the `game_upgrade_*` policies: authenticated incl. community read, anon none.
- `costs` keeps `[{type, id, amount}]`; new `type` value `counter`, ids `chip_exp` and `chip_duplicate:<quality>`.
- English UI; search matches `name` and `name_ko`.

## Findings that fix the design (from the client tables, 2026-11-08)

- `car_microchip` (32 rows): quality 2 green / 3 blue (4 slots each), 4 purple / 5 orange (4 slots × 3 troop types). Purple crafts from 400 × Common Chip Material (300003), orange from 800 × Advanced Chip Material (300004).
- `car_microchip_promote` (204 rows): `quality`, `rank` (= star, 0–10), `grade` (= sub-step, 0–9), `cost_goods` (star-up EXP), `cost_self` (duplicates of the same chip), `value_self` (EXP the chip is worth when fed: green 500, blue 5,000, purple 50,000). Green and blue have one row and no costs: not upgradeable. Purple and orange have 101 rows each, (0,0)…(10,0); every row costs EITHER EXP or duplicates, never both; (10,0) costs nothing. Duplicates: 1 at 0.9, 2 at 1.9, 3 at 2.4/2.9, 5 at 3.4/3.9, 10 at 4.4/4.9, 12 at 5.3/5.6/5.9, 15 at 6.x, 20 at 7.x, 30 at 8.2/8.4/8.7/8.9, 50 at 9.2/9.4/9.7/9.9 — 500 per chip per quality.
- EXP cards are `goods.type = 224` with `para1` = EXP: 300017 (500), 300005 Small (10,000), 300006 Big (30,000), 300030 Big (60,000).
- `car_microchip_attribute` is per-chip stats/power (2,432 rows); `car_microchip_grading` is the resonance bonus. Neither is a cost. Power is per chip, not per quality, so chip steps carry `power = null`.
- `building.building_season` exists: 2 (760000s), 3 (743000s + 851000s = our Season 2), 4 (857000–867000 = our Season 3), 6 (868000–878000), 8, 10. It is the game's theme id, not our `seasons.season_id`, so the column is named `game_season`. All season rows have populated `cost_consume`/`item` and `time`.

## Review Focus

1. A `costs` row with `type` outside the three values must be refused by the constraint, not land silently (Task 2 pgTAP `throws_ok`).
2. A chip step whose row costs nothing (the top row) must yield no step (Task 1 test asserts 100 steps per quality).
3. `parseCalculatorHash` with `to < from`, negative numbers, or `speed=abc` must clamp, never throw (Task 5 fixtures).
4. A hand-off whose `to` is not above the account's current level must add no target (Task 6 `handoffTarget` returns null).
5. `routeFromHash('#/planner?target=…')` must still resolve to the planner, or the hand-off lands on the overview (Task 6 test).

---

### Task 1: Chip steps and EXP-card values in the importer

**Files:**
- Modify: `services/collector/src/dw_collector/gamedata/catalog.py`
- Modify: `services/collector/src/dw_collector/cli.py:939-985` (count line)
- Test: `services/collector/tests/test_gamedata.py`

**Interfaces:**
- Produces: `Catalog._chip_steps() -> Iterator[Row]` yielding `kind='chip'`, `subject_id=str(quality)`, `level = rank*10 + grade + 1`, `name = name_ko = chip_label(level)`, `costs` with counters; `chip_label(level: int) -> str` ("0★ 5/10", "10★ 0/10"); items of type 224 carry `counter_value = {"id": "chip_exp", "amount": para1}`, all other items `None`.

- [ ] **Step 1: Write failing tests** in `test_gamedata.py`: add `car_microchip_promote` (quality 4 rows (0,0) 500 EXP, (0,1) 1000, (0,9) cost_self 1, (1,0) 13000, (10,0) empty; quality 2 single row) and goods 300030 type 224 para1 60000 to `CATALOGUE_TABLES` / `CATALOGUE_EN`. Tests:
  - `test_chip_steps_flatten_star_and_substep_and_count_exp_or_duplicates`: steps for kind chip subject "4": level 1 costs `[{"type":"counter","id":"chip_exp","amount":500}]`, name "0★ 1/10"; level 10 costs `[{"type":"counter","id":"chip_duplicate:4","amount":1}]`, name "1★ 0/10"; level 11 costs 13000 EXP; no level 101; no subject "2".
  - `test_exp_cards_carry_their_counter_value`: item 300030 `counter_value == {"id":"chip_exp","amount":60000}`; item 253042 `counter_value is None`.
  - `test_chip_label`: `chip_label(5) == "0★ 5/10"`, `chip_label(100) == "10★ 0/10"`.
- [ ] **Step 2: Run** `uv run pytest tests/test_gamedata.py -k chip` → FAIL (no `_chip_steps`).
- [ ] **Step 3: Implement** `CHIP_EXP_CARD = 224`, `chip_label`, `_chip_steps` (a step exists when the next row — same rank grade+1, or rank+1 grade 0 after grade 9 — exists and the row has a non-zero `cost_goods` or `cost_self`); `_step` gains `literal_name: str | None` used for both languages; `items()` adds `counter_value`; `steps()` yields chips; cli count line appends `exp-cards=N`.
- [ ] **Step 4: Run** the whole gamedata test file → PASS; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
- [ ] **Step 5: Commit** `feat(collector): chip star-up steps and EXP card values from the client tables`.

### Task 2: Migration 0309 and pgTAP

**Files:**
- Create: `supabase/migrations/20260728000309_counter_costs_chip_steps.sql`
- Create: `supabase/tests/309_counter_costs_chip_steps_test.sql`
- Modify: `packages/shared-types/src/database.types.ts` (game_upgrade_steps + game_items + game_upgrade_subjects + Functions)

**Interfaces:**
- Produces: `public.costs_are_valid(jsonb) returns boolean` (immutable); `game_upgrade_steps.costs` check uses it; `kind` check adds `'chip'`; `game_upgrade_steps.game_season int null`; `game_items.counter_value jsonb null` (object with `id` and `amount`); view `game_upgrade_subjects` adds `game_season` (= `min(s.game_season)`), body copied from 0224.

- [ ] **Step 1: Write the pgTAP file** (plan(8)): as `service_role` a chip row with a counter cost inserts; a cost `type='gold'` throws 23514; a counter with numeric id throws 23514; a building row with `game_season=6` shows `game_season=6` in `game_upgrade_subjects`; `game_items.counter_value='[1]'` throws 23514 and `'{"id":"chip_exp","amount":60000}'` inserts; community (fixture as in 111) selects 1 chip row; `set local role anon` select throws 42501.
- [ ] **Step 2: Run** `pnpm db:test:local` → the new file fails (constraint missing).
- [ ] **Step 3: Write the migration**: function + revoke from public/anon, grant execute to service_role and authenticated; drop/re-add both checks; add columns with comments; `create or replace view` with the added column (same grants as 0224 — `security_invoker = true` keeps them).
- [ ] **Step 4: Hand-edit `database.types.ts`** for the three relations and the function.
- [ ] **Step 5: Run** `pnpm db:test:local` → all green; `pnpm typecheck`.
- [ ] **Step 6: Commit** `feat(db): counter costs, chip kind, game_season on steps (0309)`.

### Task 3: `plan.ts` counters

**Files:**
- Modify: `apps/dashboard/src/features/planner/plan.ts`, `Breakdown.tsx`
- Test: `apps/dashboard/src/features/planner/plan.counter.test.ts` (new file; `plan.test.ts` untouched)

**Interfaces:**
- Produces: `Kind` adds `'chip'`; `Cost['type']` and `MaterialTotal['type']` add `'counter'`; `stockable(materials: ReadonlyArray<MaterialTotal>): MaterialTotal[]` drops counters.

- [ ] **Step 1: Failing tests**: two chip steps (500 + 1000 `chip_exp`, 1 `chip_duplicate:4`) → `totals` materials `[{counter chip_exp 1500},{counter chip_duplicate:4 1}]`, unchanged with `costReduction: 50`; `stockable` keeps resource and item, drops counter.
- [ ] **Step 2: Run** `pnpm --filter dashboard test -- plan.counter` → FAIL (type error / no `stockable`).
- [ ] **Step 3: Implement**; `Breakdown` computes `covered` over `stockable(sums.materials)` and renders `—` in Have/Missing for counter rows.
- [ ] **Step 4: Run** all planner tests → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(planner): counter costs total by id and are never stock`.

### Task 4: Season buildings, chips and search modules

**Files:**
- Create: `apps/dashboard/src/features/calculator/seasons.ts` (+ `.test.ts`), `chips.ts` (+ `.test.ts`), `search.ts` (+ `.test.ts`)
- Modify: `apps/dashboard/src/features/planner/data.ts` (`Subject`, `fetchCatalogSubjects`)

**Interfaces:**
- `Subject` gains `nameKo: string | null` and `gameSeason: number | null`; `fetchCatalogSubjects(kind, { category?, subjects?, seasonal?: boolean })` selects `name_ko, game_season`, `seasonal` → `.not('game_season','is',null)`.
- `seasons.ts`: `OUR_SEASON_BY_GAME_SEASON = {3: 2, 4: 3}`; `seasonLabel(gameSeason: number): string` → "Season 2" when mapped else "Game season 6"; `groupBySeason(subjects: ReadonlyArray<Subject>): SeasonGroup[]` (`{gameSeason, label, subjects}` sorted by gameSeason, subjects by subject id, null seasons dropped).
- `chips.ts`: `CHIP_QUALITIES = {4:'Purple', 5:'Orange'}`, `chipLabel(level)`, `chipStepName(level)` ("0★ 4/10 → 0★ 5/10"), `chipLevel(star, sub)`, `CHIP_MAX_LEVEL = 100`.
- `search.ts`: `matchesSubject(s: {name: string; nameKo: string|null}, query: string): boolean`; `filterSubjects<T extends …>(list, query): T[]`.

- [ ] **Step 1–3:** tests first (labels above; "강철" matches a subject whose `nameKo` holds it; "" matches all; case-insensitive on `name`), run red, implement, run green.
- [ ] **Step 4: Commit** `feat(calculator): season grouping, chip labels, bilingual subject search`.

### Task 5: `url.ts`

**Files:** Create `apps/dashboard/src/features/calculator/url.ts`, `url.test.ts`.

**Interfaces:** `CALCULATOR_HASH = '#/calculator'`; `CalculatorKind` = planner kinds minus `pet_break` plus `chip`; `CalculatorState {kind, subject: string|null, from, to, speed, cost}`; `parseCalculatorHash(hash: string): CalculatorState` (never throws; unknown kind → `building`; `from` ≥ 0, `to` ≥ `from`, `speed` 0..10000, `cost` 0..100, non-numeric → 0, subject must match `/^[A-Za-z0-9:_]{1,40}$/` else null); `calculatorHash(state): string` omits zero `from`/`speed`/`cost` and null subject; `clampToRange(state, maxLevel): CalculatorState`.

- [ ] Fixtures: full example from the spec round-trips; `#/calculator` alone → defaults; `kind=dragon` → building; `from=30&to=28` → to 30; `speed=-5&cost=abc` → 0/0; `clampToRange(to 999, max 30)` → 30. Red → implement → green → commit `feat(calculator): URL state parse and serialise`.

### Task 6: Hand-off

**Files:** Create `apps/dashboard/src/features/calculator/handoff.ts`, `handoff.test.ts`, `useHandoff.ts`; modify `apps/dashboard/src/lib/route.ts` (`routeFromHash` strips `?…`), `apps/dashboard/src/features/planner/PlannerPage.tsx` (one import, one hook call).

**Interfaces:** `HANDOFF_KINDS = ['building','research','exclusive','vehicle','vehicle_part']`; `Handoff {kind, subject, to}`; `plannerHandoffHash(h): string` → `#/planner?target=building:409000:30`; `readHandoff(hash): Handoff | null`; `stripHandoff(hash): string`; `currentLevel(account: Account, h): number`; `handoffTarget(h, account, name): Target | null` (null when `to <= from`). `useHandoff(account: Account | undefined, onTarget: (t: Target) => void): void` reads once, strips, resolves the name via `fetchCatalogSubjects` (vehicle → "Vehicle"; exclusive → "<weapon> · exclusive weapon"), then calls `onTarget`.

- [ ] Tests: round-trip; `readHandoff('#/planner')` null; unknown kind `hero` null; `routeFromHash(plannerHandoffHash(…)) === 'planner'`; `currentLevel` per kind from an account fixture; `handoffTarget` null when not above. Red → implement → green → `pnpm test` whole dashboard → commit `feat(calculator): planner hand-off through the hash`.

### Task 7: Dry run, runbook, verification, PR

- [ ] Run the real `game-catalog --dry-run`; record the count line.
- [ ] Update `docs/runbooks/game-data.md` §5 with the new kind, the counter cost, `game_season`, EXP cards, and the 0309 ordering note.
- [ ] `pnpm check && pnpm typecheck && pnpm test && pnpm db:test:local`; `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest`.
- [ ] Re-check `origin/main`'s highest migration; `scripts/check-migration-order.sh`; push; draft PR.
