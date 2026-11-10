# Event Guide Framework — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The reading page and the officer editor for event guides, on the console kit, over the phase A model (0310) with no new migration.

**Architecture:** A `Guides` tab on `#/event-guide` (address `#/event-guide/guides/<slug>`) lists published guides, upcoming first, and renders one guide's sections through six small renderers built from `Chip`, `StepTable`, `CellGrid`/`Cell` and `Led`. An `Event guides` panel in Admin › Shared lists guides, edits the guide row, and edits each section through a structured form per kind; client sections are read-only except an item column that writes `game_event_score_items`. All derivation stays in the phase A pure functions; new pure logic (ordering, start times, draft payloads, search filter) is tested first.

**Tech Stack:** React 18, TanStack Query, supabase-js, vitest + @testing-library/react, biome. CSS in `features/eventGuide/guides.css`, imported from the components.

**Specs:** `docs/superpowers/specs/2026-11-08-event-guide-framework-design.md` (Dashboard, Migration of the two existing guides, Access) and `docs/superpowers/specs/2026-11-08-console-foundation-design.md` (tokens, kit, copycat test).

## Global Constraints

- Tokens only: no colour literal (`#rgb`, `rgb(`, `hsl(`) in any rule added. `guides.css` is imported from components, never from `index.css`.
- Copycat test: no navy or cyan, no glow except `Led`, no card on a shadow, no pills (`border-radius` at most `var(--radius-sm)`), labels mono uppercase via `--text-label`, figures `var(--font-mono)` + `tabular-nums`, cells share borders.
- English UI only. `*_ko` fields are optional data inputs in the editor and are never read by the reading page.
- Filter chips use `.filter-chip`; the kit chip is `Chip` (`.chip-console`); `.chip` is the arena lineup and is not used.
- No migration, no collector change. Writes go through RLS (`guide.write` / `guide.edit` / `guide.delete`); the UI reports what the database answers.
- The picker shows `published` guides only; a writer additionally sees drafts, marked `DRAFT`.
- Icons render only when the icon query returns one (`GameIcon` returns nothing otherwise).
- The two legacy tabs (Survival Preparedness, Alliance Duel) stay unless the new rendering shows the same information; it does not (no week grid, no "now" slot, no daily/weekly score to reach), so they stay and the PR says so.
- Gates: `pnpm check && pnpm typecheck && pnpm test && pnpm build`.

## Review Focus

1. A guide with zero parsable sections, or a section whose payload fails its validator → the guide still opens; the broken section is skipped on the reading page and shown as "cannot be read" in the editor. (Task 3 test, Task 6 test.)
2. A viewer with no `account_state_latest` row (community, or member never seen logging in) → prep cells show the rule only, never `0 held`. (Task 3 test.)
3. A search string with PostgREST filter syntax (`,` `(` `)` `%` `*` `\`) in the item picker → stripped, never sent into `.or(...)`. (Task 5 test.)
4. An activity guide with no row in `event_schedule_current` and an empty `starts_rule` → sorted last as "no start known", not as starting now. (Task 2 test.)
5. Saving a section whose form state does not parse (a stage with no drops is fine; a points field left blank is not) → Save disabled with the reason, nothing sent. (Task 5 test.)

---

### Task 1: Address for the Guides tab

**Files:** Modify `apps/dashboard/src/lib/route.ts`, `apps/dashboard/src/App.tsx`; Test `apps/dashboard/tests/route.eventGuide.test.ts` (new).

**Interfaces (produces):** `EventGuideTab` gains `'guides'` (label `Guides`, placed second, open to community). `eventGuideSlugFromHash(hash: string): string | null` — the `<slug>` of `#/event-guide/guides/<slug>` (`[a-z0-9-]+`), else null. `eventGuideHash(tab, slug?)` — `#/event-guide/guides/<slug>` when tab is `guides` and a slug is given. `eventGuideTabFromHash('#/event-guide/guides/halloween-2026')` is `'guides'`. `EventGuidePage` takes `{ tab, slug }`.

- [ ] Failing tests for the four behaviours above plus: an unknown third segment under another tab (`#/event-guide/duel/x`) is not an event-guide address (tab falls back as an unknown hash does today).
- [ ] Run: FAIL. Implement. Run: PASS. Existing route tests still pass.
- [ ] Commit `feat(dashboard): an address for event guides by slug`.

### Task 2: Guide data and ordering

**Files:** Create `apps/dashboard/src/features/eventGuide/guides.ts`, `guideData.ts`; Test `guides.test.ts`.

**Interfaces (produces), `guides.ts` (pure):**
- `interface GuideRow { guide_id: string; activity_id: string | null; slug: string; title: string; title_ko: string | null; summary: string | null; summary_ko: string | null; starts_rule: unknown; published: boolean; post_id: string | null; updated_at: string }`
- `interface StartsRule { weekday?: number; time?: string; servers?: string; note?: string }`; `parseStartsRule(v: unknown): StartsRule` (weekday 1–7 Monday=1, time `HH:MM` server time; anything else dropped).
- `nextRuleStart(rule: StartsRule, now: Date): Date | null` — next server-time (UTC−2) occurrence of weekday+time at or after `now`; null without both.
- `interface GuideStart { startsAt: string | null; endsAt: string | null; state: 'live' | 'upcoming' | 'ended' | 'unknown'; source: 'calendar' | 'rule' | 'none' }`
- `guideStart(guide: GuideRow, schedule: readonly { activity_id: string; starts_at: string | null; ends_at: string | null }[], now: Date): GuideStart` — with `activity_id`: among that activity's rows, a live one wins, else the soonest upcoming, else the latest ended; without rows or without `activity_id`: the rule; else `unknown`.
- `orderGuides(guides, schedule, now, includeDrafts: boolean): { guide: GuideRow; start: GuideStart }[]` — unpublished dropped unless `includeDrafts`; order live, upcoming (soonest first), ended (latest first), unknown; ties by title.
- `refsIn(sections: readonly ParsedSection[]): ItemRef[]` — every distinct `item_ref` in any payload, by `itemRefKey`.
- `stockLed(capturedAt: string | null, now: Date): { tone: LedTone; text: string }` — null → `neutral` / `NO LINKED ACCOUNT`; under 24 h → `ok` / `STOCK READ 3h`; under 7 d → `warn` / `STOCK READ 2d`; older → `bad`.
- `slugify(title: string): string` — lower-case, `[a-z0-9]` runs joined by `-`, at most 80, empty → `guide`.

**`guideData.ts` (queries/mutations, not unit-tested):** `useGuides()`, `useGuideSections(guideId)`, `useScoreItems()`, `useGuideSchedule()` (reuses `fetchCalendar` under its existing key if exported with one, else its own), `useRefCatalogue(refs)` → `{ catalogue: ItemCatalogue; iconSrc: Map<string, string> }` (names from `game_items` / `game_resources` / `heroes` by the ids shown; icons via `fetchIcons(kind, ids)` keyed by `itemRefKey`), `useViewerStock()` → the planner's `['planner-accounts']` query. Mutations: `saveGuide`, `deleteGuide`, `saveSection`, `deleteSection`, `saveScoreItem`, `clearScoreItem`; each throws `Error(message)` on a PostgREST error and the caller invalidates `['event-guides']`.

- [ ] Failing tests: `parseStartsRule` drops a weekday of 9 and a time of `25:00`; `nextRuleStart({weekday: 1, time: '00:00'}, Sunday 23:00 server)` is one hour later, and on the Monday at 00:00 exactly is that instant; `guideStart` live beats upcoming, picks soonest upcoming across servers, falls to the rule, and is `unknown` with neither (Review Focus 4); `orderGuides` order and draft filtering; `refsIn` over the Halloween fixtures returns shard, candy, coin, wood, ammo once each; `stockLed` four tones; `slugify('Halloween 2026!')` → `halloween-2026`.
- [ ] Run: FAIL. Implement `guides.ts`. Run: PASS. Write `guideData.ts`; `pnpm typecheck`.
- [ ] Commit `feat(dashboard): event guide queries, ordering and start times`.

### Task 3: Section renderers

**Files:** Create `apps/dashboard/src/features/eventGuide/GuideSections.tsx`, `guides.css`; Test `GuideSections.test.tsx`.

**Interfaces:**
- Consumes `ParsedSection`, `bestDays`, `mergeScoreItems`, `derivePrep`, `resolveItemRef`, kit components.
- Produces `GuideSections({ sections, catalogue, iconSrc, scoreItems, stock, stockReadAt, now }: { sections: readonly ParsedSection[]; catalogue: ItemCatalogue; iconSrc: ReadonlyMap<string, string>; scoreItems: ScoreItemMap; stock: Stock | null; stockReadAt: string | null; now: Date })`. One `<section className="eg-section" data-kind=…>` per section with an `<h3>`.
  - `rewards`: `<ul className="eg-chips">`, one `Chip` per reward (`label`, `suffix` = kind, icon when known) followed by the `how` text.
  - `stages`: one `StepTable` (columns Group, Stage, Drops), drops as `Chip`s with `figure` = `×qty`; `total` row = totals; `foldAt` 20.
  - `point_table`: heading `Day N · theme` (theme alone when `day` is null); `StepTable` columns Action, Item, Points (numeric, `+750`, `per 100` suffix when `per` ≠ 1), Best. The Best cell shows `BEST DAY` when this table's day is in `bestDays(...)` for the row's item, and `day 2` (muted) when another day wins. Tables are merged with `scoreItems` before `bestDays` runs.
  - `prep`: a `Led` from `stockLed`, then `CellGrid` with one `Cell` per item: label = item name; with stock: value = held, unit = `/cap` when capped, context = `→ 309,000 pts on day 2` (or `→ 50 shots`); without: value `—`, context = the rule (`750 pts each · cap 412 · day 2`).
  - `sources`: `StepTable` columns Source, Rate, Cap (numeric, `—` when null), `total` row `Total` / note / `total_cap`.
  - `notes`: paragraphs split on blank lines.

- [ ] Failing render tests with the Halloween fixtures: a rewards chip per item; stages table has 5 body rows and a total row containing `19`; day 2 table shows `BEST DAY` and day 5 shows `day 2`; a client table with only `score_id` shows the mapped item once `scoreItems` has it and no Best cell without; prep with stock `{items: {'253042': 412}}` contains `309,000` and `day 2`; prep with `stock: null` contains `750 pts each` and no `held` figure, and the Led reads `NO LINKED ACCOUNT` (Review Focus 2); sources total row contains `170`; `GuideSections` with an empty list renders the empty sentence `This guide has no sections yet.` (Review Focus 1).
- [ ] Run: FAIL. Implement + `guides.css` (tokens only). Run: PASS; `pnpm check`.
- [ ] Add a test that reads `guides.css` and asserts no `#hex`, `rgb(`, `hsl(` and no `border-radius` above `var(--radius-sm)`.
- [ ] Commit `feat(dashboard): event guide sections on the console kit`.

### Task 4: The Guides tab

**Files:** Create `apps/dashboard/src/features/eventGuide/GuidesTab.tsx`; Modify `EventGuidePage.tsx`; Test `GuidesTab.test.tsx` (the presentational `GuidePicker` and `GuideHeader` only).

**Interfaces:** `GuidesTab({ slug }: { slug: string | null })` — loads guides, schedule, permissions; picker = `.filter-chip` buttons (`aria-pressed`), each with the title and a muted start (`live`, `in 3d`, `ended`); selecting sets `#/event-guide/guides/<slug>`; no slug → the first ordered guide. Header: title, summary, a `Led` for the state (`LIVE` ok, `STARTS IN 3d` warn, `ENDED` neutral, `NO START KNOWN` neutral), start in server time with the viewer's zone in brackets (the page's existing `localHint` rule), `DRAFT` marker, link to the long-form post when `post_id` is set (`#/guides` board address as that board uses). Account `Select` above the prep section when the viewer can see more than one account. Empty: `No guide has been published yet.` `GuidePicker({ entries, selected, onSelect, now })` and `GuideHeader({ guide, start, now, zone })` are exported for tests.

- [ ] Failing tests: picker marks the selected guide `aria-pressed="true"` and lists live before upcoming; a draft shows `DRAFT`; header Led text for the four states.
- [ ] Run: FAIL. Implement; wire `tab === 'guides'` in `EventGuidePage` (no dependence on the 0248 tables). Run: PASS.
- [ ] Commit `feat(dashboard): the Guides tab: picker and guide view`.

### Task 5: Editor logic, item picker, section forms

**Files:** Create `apps/dashboard/src/features/eventGuide/editor/drafts.ts`, `ItemPicker.tsx`, `SectionForms.tsx`; Test `editor/drafts.test.ts`, `editor/SectionForms.test.tsx`.

**Interfaces (`drafts.ts`, pure):**
- `emptyPayload(kind: SectionKind): SectionPayload['payload']` — the smallest payload that the kind's validator accepts where possible (`notes` starts with `text: ''`, which does not parse until typed).
- `validateDraft(kind: SectionKind, payload: unknown): { ok: true; payload: SectionPayload } | { ok: false; reason: string }` — `parseSection` plus a reason sentence per kind (`Every row needs an action and a number of points.`).
- `setAt<T>(list: readonly T[], index: number, value: T): T[]`, `removeAt<T>(list, index): T[]`, `moveAt<T>(list, index, delta: -1 | 1): T[]` — immutable.
- `searchFilter(q: string): string | null` — trims, strips `, ( ) % * \` and quotes, collapses spaces; null under 2 characters.
- `numberOrUndefined(text: string): number | undefined` — `''` → undefined; a non-number → `NaN` (so the validator rejects it, rather than silently dropping the field).

**`ItemPicker({ value, onChange, catalogue, iconSrc, id })`:** shows the chosen ref as a `Chip` with a Clear button, or a search box; results from `game_items` and `game_resources` (`name` or `name_ko` `ilike`, 8 each) as buttons with icon and name. `searchItems(q)` lives in `guideData.ts`.

**`SectionForms.tsx`:** `SectionForm({ kind, payload, onChange, catalogue, iconSrc })` dispatching to `RewardsForm`, `StagesForm`, `PointTableForm`, `PrepForm`, `SourcesForm`, `NotesForm`. Each is controlled: it renders inputs for the payload it is given and calls `onChange(nextPayload)`; row tables use the `.compact` table primitive with Add / Remove / Up / Down buttons. Every input has an `aria-label` or `<label>`.

- [ ] Failing tests: `emptyPayload` for the five structured kinds passes `validateDraft`; `validateDraft('point_table', {day: 2, theme: null, rows: [{action: 'x', points: NaN}]})` is `{ok: false}` with the points sentence (Review Focus 5); list helpers do not mutate; `searchFilter('or(name.ilike.*,x)')` contains none of `( ) , * %` (Review Focus 3) and `searchFilter('a')` is null; `NotesForm` typing calls `onChange({text: 'Hello', text_ko: null})`; `SourcesForm` Add row appends `{source: '', rate: '', cap: null}`; `PrepForm` clearing the cap input yields a payload without `cap`.
- [ ] Run: FAIL. Implement. Run: PASS.
- [ ] Commit `feat(dashboard): event guide section forms and item picker`.

### Task 6: The admin panel

**Files:** Create `apps/dashboard/src/features/admin/EventGuidesSetting.tsx`, `apps/dashboard/src/features/eventGuide/editor/GuideForm.tsx`, `editor/SectionList.tsx`; Modify `apps/dashboard/src/lib/adminAccess.ts`, `features/admin/AdminPage.tsx`, `tests/adminAccess.test.ts`; Test `editor/SectionList.test.tsx`.

**Interfaces:**
- `ADMIN_SECTIONS` gains `{ group: 'catalogue', id: 'event-guides-heading', heading: 'Event guides', requires: capability('guide.write') }` after Events; `AdminPage` mounts `<EventGuidesSetting />` for slug `event-guides`.
- `EventGuidesSetting`: guide table (Title, Address, Activity, State `PUBLISHED`/`DRAFT`, Sections) with a row button `Edit`; `New guide` form (title → slug prefilled by `slugify`). Selected guide: `GuideForm` then `SectionList`.
- `GuideForm({ guide, posts, onSave, onDelete, saving })`: title, slug, summary, published checkbox, post `Select` (published board posts), start rule (weekday `Select`, time, servers, note) under the sentence `Used only when the game's calendar has no time for this event` and disabled-with-note when `activity_id` is set; optional `title_ko` / `summary_ko` inputs labelled `Korean title (data only)`. Delete asks for confirmation with the existing dialog pattern and is offered only when `guide.delete` is held.
- `SectionList({ sections, scoreItems, catalogue, iconSrc, onSaveSection, onDeleteSection, onSaveScoreItem, onClearScoreItem, canDelete })`: sections in order; officer sections expand to `SectionForm` + title + sort order + Save (disabled with `validateDraft`'s reason) + Delete; client sections show the read-only rows with the note `Written by the importer. Re-import to refresh.` and an Item column (`ItemPicker`) per row that calls `onSaveScoreItem(score_id, ref)`; a section whose payload does not parse shows `This section cannot be read.` with Delete (Review Focus 1). `Add section` with a kind `Select`.

- [ ] Failing tests: a client section renders no text input for its rows, shows the importer note, and choosing an item calls `onSaveScoreItem('1000020101', {kind:'item', id:'253042'})`; an officer notes section with empty text has Save disabled and shows the reason; an unparsable section shows `cannot be read`; `adminAccess` test updated: catalogue group lists `Event guides` for an officer holding `guide.write` and not for a member.
- [ ] Run: FAIL. Implement. Run: PASS.
- [ ] Commit `feat(dashboard): event guide editor in Admin`.

### Task 7: Look at it, gate it, PR

- [ ] A dev-only preview (`apps/dashboard/preview/event-guide.html` + `.tsx`, outside `src`, not a build input) renders `GuideSections`, `GuidePicker`, `GuideHeader`, `SectionList` and `GuideForm` from fixtures with no network. Check light, dark and 320px in the Browser pane; fix what overflows or fails the copycat list; screenshot.
- [ ] `pnpm check && pnpm typecheck && pnpm test && pnpm build`.
- [ ] Push; draft PR `feat(event-guide): reading page and officer editor (phase B)` with gate results, rulings against the spec, what was checked in the preview and what could not be checked signed in (real data, RLS answers, icon rows, the account gate).
