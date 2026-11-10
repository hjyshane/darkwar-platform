# Calculator reference mode — phase B implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `#/calculator` page: pick a subject, set from/to and buffs, read totals and a step table, copy the link, hand the selection to the planner.

**Architecture:** The URL is the state (`url.ts`, phase A). A pure `model.ts` turns that state into planner goals, buffs, table rows and notes; `data.ts` reads subjects and steps through the planner's own `fetchCatalogSubjects` / `loadBook` / `plan`, so there is one cost engine. `CalculatorPage` composes the console kit (`CellGrid`, `Cell`, `StepTable`, `Chip`) with a feature stylesheet imported from the component.

**Tech Stack:** React 18, TanStack Query, Vitest + Testing Library, the console kit in `components/console/`, tokens in `index.css`. One Python fix in `gamedata/catalog.py`.

**Spec:** `docs/superpowers/specs/2026-11-08-calculator-reference-design.md` (page), `docs/superpowers/specs/2026-11-08-console-foundation-design.md` (visual system).

## Global Constraints

- Tokens only: no colour literal in `calculator.css`; kit CSS is imported from components, never from `index.css`.
- Copycat test: no navy or cyan, no glow except LEDs, no card on a shadow, no pills, labels mono uppercase, figures tabular mono, cells share borders.
- English UI. Subject search matches `name` and `name_ko`.
- Filter chips are `.filter-chip`; `.chip` is the arena lineup; the kit's is `.chip-console`.
- No duplicated cost logic: totals and steps come from `plan.ts`.
- The URL carries only kind, subject, from, to, speed, cost; an inert buff is never serialised.
- Signed-in only; community is offered the page.
- No migration is needed. If one becomes necessary it is **0316**.
- Gates: `pnpm check && pnpm typecheck && pnpm test && pnpm build`; Python gates because the collector is touched.

## Finding that changes scope

Phase A's importer reads `building_season` from the row of the level a step REACHES. The client sets that column only on each season building's level-0 row (868000 has `'6'`, 868001…868030 have `''`), so every step got `game_season = null` and the season picker would be empty on prod. Task 1 fixes it. `game-catalog` must be re-run after merge.

## Review Focus

1. A subject whose track starts above level 1 (hero, vehicle, pet start at 2): `from` must floor at 1 or the plan reports a gap and prices nothing (Task 2 `levelFloor`).
2. A link whose subject does not exist in the catalogue: the page says so and shows no totals, never a blank or a crash (Task 5 render test).
3. `to` beyond the subject's track in a pasted link: clamped once the range is known (Task 2 `clampToRange` use, Task 5).
4. A chip total with no EXP card rows readable (`counter_value` not yet re-imported): the notes line states the EXP figure without a conversion, never divides by zero (Task 2 `notesFor`).
5. A step table wider than a 320px screen: scrolls inside its own wrapper; the page body never scrolls sideways (Task 6 check).

---

### Task 1: Season of a building comes from its level-0 row

**Files:** Modify `services/collector/src/dw_collector/gamedata/catalog.py` (`_building_steps`), `services/collector/tests/test_gamedata.py`, `docs/runbooks/game-data.md`.

- [ ] **Step 1: Failing test** `test_a_season_building_takes_its_season_from_its_base_row`: a catalogue whose `building` table has 868000 (`building_season '6'`), 868001 and 868002 (`''`) yields steps for subject `868000` at levels 1 and 2, both with `game_season == 6`; the 727000 step keeps `game_season is None`. `_catalogue(tables=None)` takes overrides so the existing one-building tests stay as they are.
- [ ] **Step 2:** `uv run pytest tests/test_gamedata.py -k season` → FAIL (`None != 6`).
- [ ] **Step 3:** `_building_steps` builds `season_of: dict[int, int]` (type → the first non-empty `building_season` among that type's rows) and passes `game_season=season_of.get(type)`.
- [ ] **Step 4:** whole file green; ruff, format, mypy. Real run through a probe: 64 seasonal subjects.
- [ ] **Step 5:** Runbook line corrected. Commit `fix(collector): a season building's season is on its level-0 row`.

### Task 2: `model.ts` — state to goals, rows and notes (pure)

**Files:** Create `apps/dashboard/src/features/calculator/model.ts`, `model.test.ts`.

**Interfaces (produces):**
- `type FormKind = CalculatorKind | 'season'`; `KIND_OPTIONS: ReadonlyArray<{ id: FormKind; label: string }>` in the spec's order (Building, Research, Hero, Hero gear, Exclusive weapon, Vehicle, Vehicle part, Chip, Pet, Season building).
- `buffFields(kind): { speed: boolean; cost: boolean }` — building both, research speed only, others neither. `withoutInertBuffs(state): CalculatorState` zeroes what the kind does not use.
- `levelFloor(kind): number` — hero, vehicle, pet 1; others 0.
- `goalsFor(state): Goal[]` — none without a subject or when `to <= from`; pet adds a `pet_break` goal per `breakthroughsCrossed(from, to, 0)`.
- `buffsFor(state): Buffs` — speed feeds construction and research speed, cost feeds cost reduction.
- `levelName(kind, subject, level, tiers): string` — building 0 → "Not built", else `levelText`; exclusive `weaponText`; chip `chipLabel`; otherwise the number.
- `stepTable(steps: ReadonlyArray<PlannedStep>, buffs): { materials: MaterialTotal[]; rows: StepRow[]; total: StepRow }` with `StepRow { key: string; kind: Kind; subject: string; level: number | null; amounts: ReadonlyMap<string, number>; seconds: number }` — each row is `totals([step], buffs)`, the total row `totals(steps, buffs)`, material key `${type}:${id}`.
- `notesFor(state, sums: Totals, cards: ReadonlyArray<ExpCard>): string[]` with `ExpCard { itemId: string; name: string; amount: number }`.

- [ ] Tests first, with these exact expectations: `buffFields('research')` → `{speed: true, cost: false}`; `withoutInertBuffs({kind:'chip', speed:35, cost:10,…})` → speed 0, cost 0; `goalsFor` pet rarity 4 from 8 to 25 → pet goal plus breaks at 10 and 20; `stepTable` of two building steps (100 wood each, 60 s) with `costReduction 50, constructionSpeed 100` → rows 50 wood / 30 s, total 100 wood / 60 s; `notesFor` chip with 129,000,000 `chip_exp`, 500 `chip_duplicate:5` and a 60,000 card → `"500 duplicates of the same chip"` and `"129M EXP = 2,150 × Big card (60,000 each)"`; with no cards → `"129M star-up EXP"`; building → the prerequisites note; exclusive reaching level 27+ → the red-ranks note.
- [ ] Red → implement → green → commit `feat(calculator): the pure model behind the reference page`.

### Task 3: `data.ts` — subjects, steps, EXP cards

**Files:** Create `apps/dashboard/src/features/calculator/data.ts`, `data.test.ts` (labelling only; queries are not unit-tested).

**Interfaces:** `fetchCalculatorSubjects(kind: CalculatorKind): Promise<Subject[]>` (hero → one "Hero level"; vehicle → "Vehicle"; hero_gear → `level:q*` only, labelled by `gearSubjectName`; chip → `chipSubjectName`; pet → "Pet · rarity N"; exclusive → weapon name plus the hero's in brackets); `loadSteps(goals): Promise<{ steps: PlannedStep[]; gaps: Plan['gaps'] }>` via `loadBook(goals, new Map(), false)` and `plan(…, false)`; `fetchExpCards(): Promise<ExpCard[]>` from `game_items.counter_value`; pure `labelSubjects(kind, rows, heroNames)` exported for the test.

- [ ] Test `labelSubjects`: gear drops `promote`, chips are "Purple chip"/"Orange chip", an exclusive reads "Pyro Pup (Margaret)". Red → implement → green → commit.

### Task 4: Route and navigation

**Files:** Modify `lib/route.ts` (`Route`, `ROUTES`, `ALLIANCE_TABS`, section switch), `lib/communityAccess.tsx`, `lib/shellNav.ts` (icon map, community filter), `lib/tabVisibility.ts`, `components/shell/icons.tsx`, `App.tsx`; tests in `lib/shellNav.tabs.test.ts`, `lib/communityAccess.test.ts`.

- [ ] Tests: `routeFromHash('#/calculator?kind=chip&subject=4')` is `'calculator'`; the nav lists "Calculator" after "Planner" for a member and for a community account; `communityMayOpen('calculator')`. Red → wire → green → commit `feat(dashboard): the calculator has a route and a sidebar entry`.

### Task 5: The page

**Files:** Create `CalculatorPage.tsx`, `CalculatorForm.tsx`, `CalculatorResult.tsx`, `calculator.css`, `CalculatorPage.test.tsx`, `calculator.css.test.ts`; modify `src/dev/fixtures.ts`.

- Form (left): kind `Select`; season `Select` when the form kind is `season`; a search input over `filterSubjects`; subject `Select`; from and to `Select`s labelled by `levelName`; speed and cost number inputs only where `buffFields` says so. Every change writes the hash with `replaceHash(calculatorHash(withoutInertBuffs(next)))`.
- Result (right): `CellGrid` with one `Cell` per material (icon in the value when readable) and a Time cell as the hero; notes as `Chip`-free plain mono lines; `StepTable` with a Step column, one numeric column per material, Time last, total row, `foldAt={20}`; buttons Copy link and Load into my plan (`canHandOff(kind)` and the viewer has a planner account or is community).
- States: no subject picked → an `.empty` prompt; unknown subject → "This link names something the catalogue does not have."; loading; error; gaps → a line naming the first level without a cost.
- [ ] Render test with a mocked `./data`: the spec link renders the Bank, totals cell "Wood" with `300K`, three step rows and a total row; a link with an unknown subject renders the not-found line; `kind=chip` shows no buff inputs and no Load button. `calculator.css.test.ts`: no `#hex`, `rgb(` or `hsl(` in the stylesheet, and it defines no `.chip` or `.cell` rule.
- [ ] Red → implement → green → fixtures for the look-around build → commit `feat(calculator): the reference page on the console kit`.

### Task 6: Look at it, gates, PR

- [ ] Look-around build (`/index.dev.html#/calculator…`): dark, light, 320px, for building, chip and the empty state. Fix what the copycat test or a sideways scroll finds.
- [ ] All gates; push; draft PR listing what could not be checked signed in.
