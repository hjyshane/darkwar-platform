# Console Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cbfw.us to the console visual system (graphite grid, amber accent, mono labels) site-wide in one PR, and ship the six kit components the four feature projects build on.

**Architecture:** Tokens change in `apps/dashboard/src/index.css` (three themed blocks: light `:root`, dark under the media query, dark under `[data-theme="dark"]`), global primitives are restyled in place under their existing class names, and a new `components/console/` folder holds presentational components with render tests. `StatTile` becomes a wrapper over `Cell` so its 103 call sites do not change.

**Tech Stack:** React 18, Vite, CSS custom properties, vitest + @testing-library/react (jsdom), biome. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-console-foundation-design.md`

## Global Constraints

- Dashboard only: no migration, no collector change, no new npm dependency.
- Both dark blocks in `index.css` (`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and `:root[data-theme="dark"] {…}`) must declare identical tokens; the same twin exists for `--chart-*` near line 2098. Task 1's test enforces it.
- Chrome blue `#7aa2f7` / `#1d4ed8` and competitor cyan `#22d3ee` / `#35c6ff` must not appear in `apps/dashboard/src/**/*.{css,ts,tsx}` after the PR; `--ink-*` rich-text colours and `@dw/ui/map.css` are the only exceptions.
- Spec token values (dark): page `#15161a`, cell `#1a1b20`, raised `#1f2026`, top/table-head `#121317`, rules `#2c2e34` / strong `#3a3d45`, text `#e8e6e1` / muted `#8d8f96`, amber `#e0b452`, on-amber `#15161a`, amber wash `#2a2415`, ok `#6cc38a`, bad `#e07070`, LED glow `0 0 6px <colour>`.
- Spec token values (light): page `#f4f3ef`, cell `#ffffff`, raised `#faf9f6`, top `#ecebe6`, rules `#d9d7cf` / `#bdbbb2`, text `#17181a` / `#686a70`, amber text and borders `#a16207`, amber fill `#e0b452` with dark text.
- Data palette: amber `#e0b452`, sage `#8fb38a`, steel `#7f98b3`, clay `#c48a6a`, plum `#a48bb8`, slate `#8d8f96`; light scheme one step darker for text use.
- Radii: cells and tables 0; chips, LED pills, buttons 3px; dialogs 6px. No box shadows except dialog and command palette.
- Labels: `--text-label` 10px, `letter-spacing: .1em`, uppercase, `--font-mono`, muted. All figures `--font-mono` with `font-variant-numeric: tabular-nums`.
- `pnpm check && pnpm typecheck && pnpm test && pnpm build` green from the repo root before every commit.

## Review Focus

1. Light scheme amber text on paper: `#e0b452` on `#ffffff` fails AA. Every place amber is text or border in light must use `#a16207` (Task 1 test asserts the light `--accent` value).
2. A `Cell` value longer than its column at 320px (a 13-digit UID, a `482 · 565` coordinate) must wrap or shrink, never overflow the grid (Task 4 test renders a long value and asserts no `overflow: visible` escape via a class contract, plus a 320px screenshot in Task 7).
3. `Ticks` with `share` undefined (sum check failed upstream) must render no percent sign at all, not `NaN%` or `0%` (Task 5 test).
4. `StepTable` with exactly the fold threshold of rows must show all rows and no "show all" control; threshold+1 shows the control (Task 6 test).
5. `StatTile` callers that pass `tone: 'flat'` must get the ordinary text colour, not a tone class (Task 4 wrapper test).

---

### Task 1: Tokens, both schemes, data palette

**Files:**
- Modify: `apps/dashboard/src/index.css:25-232` (three theme blocks), `apps/dashboard/src/index.css:2098-2140` (chart tokens, three blocks)
- Create: `apps/dashboard/src/styles/tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties every later task uses: `--bg`, `--bg-cell` (new), `--bg-raised`, `--bg-top` (new), `--border`, `--border-strong`, `--fg`, `--fg-muted`, `--accent`, `--accent-fg` (new), `--accent-wash` (new), `--ok`, `--bad` (new plain colours beside the existing `--ok-bg/fg` pairs), `--led-glow-ok`, `--led-glow-bad`, `--led-glow-warn` (new), `--text-label` (new), `--data-1` … `--data-6` (new), `--chart-1` … `--chart-9`, `--tier-*`, `--info-*`, `--gold*` (now aliases of amber).

- [ ] **Step 1: Write the failing test**

`apps/dashboard/src/styles/tokens.test.ts` reads `index.css` with `node:fs`, extracts the three blocks by their exact selectors, and asserts:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const block = (open: string) => {
  const start = css.indexOf(open);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
};
const tokens = (s: string) => Object.fromEntries([...s.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

describe('console tokens', () => {
  it('declares the same dark tokens under the media query and the attribute', () => {
    const media = tokens(block(':root:not([data-theme="light"]) {'));
    const attr = tokens(block(':root[data-theme="dark"] {'));
    expect(attr).toEqual(media);
  });
  it('uses amber as the accent and the spec surfaces', () => {
    const dark = tokens(block(':root[data-theme="dark"] {'));
    expect(dark['--accent']).toBe('#e0b452');
    expect(dark['--bg']).toBe('#15161a');
    expect(dark['--bg-cell']).toBe('#1a1b20');
    expect(dark['--border']).toBe('#2c2e34');
    const light = tokens(block(':root {'));
    expect(light['--accent']).toBe('#a16207');
    expect(light['--bg']).toBe('#f4f3ef');
  });
  it('retires chrome blue and cyan everywhere except ink colours', () => {
    const stripped = css.replace(/--ink-[\w-]+:\s*[^;]+;/g, '');
    expect(stripped).not.toMatch(/#7aa2f7|#1d4ed8|#22d3ee|#35c6ff/i);
  });
  it('keeps the chart twin in step', () => {
    const chartMedia = tokens(block(':root:not([data-theme="light"]) {\n    --chart-1'));
    const chartAttr = tokens(block(':root[data-theme="dark"] {\n  --chart-1'));
    expect(chartAttr).toEqual(chartMedia);
  });
});
```

Adjust the `block()` anchors to the exact text once Step 3 has rewritten the chart section; the assertion set is what matters.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter dashboard test -- src/styles/tokens.test.ts`
Expected: FAIL on `--accent` (`#1d4ed8`) and the blue match.

- [ ] **Step 3: Rewrite the three theme blocks in `index.css`**

In `:root` (light), the media dark block and the attribute dark block, set every token listed in Global Constraints. Add the new tokens (`--bg-cell`, `--bg-top`, `--accent-fg`, `--accent-wash`, `--ok`, `--bad`, `--led-glow-*`, `--text-label: 0.625rem`, `--data-1..6`). Set `--gold: var(--accent); --gold-strong: var(--accent); --gold-bg: var(--accent-wash); --gold-fg: var(--fg)`. Set `--info-bg/fg` to `#1e242c`/`#9fb0c3` dark, `#e6ebf1`/`#334155` light. Rebuild `--tier-*` from the data palette: backbone steel, elite clay, advanced plum, commander amber-on-dark (bg = colour at 25% over `--bg-cell`, fg = colour; light = darkened colour as fg on a pale wash). `--radius-md: 3px; --radius-lg: 6px;` and leave `--radius-sm`/`--radius-pill` declared but unused by globals. `--shadow-1: none`.

In the chart section (line 2098 area) map `--chart-1..6` to `--data-1..6` and set `--chart-7..9` to darker steps of sage, clay and steel (`#6f9470`, `#a87052`, `#60788f` dark; light one step darker again), in all three blocks.

- [ ] **Step 4: Run the test and look at the site**

Run: `pnpm --filter dashboard test -- src/styles/tokens.test.ts`
Expected: PASS. Then start the dev server through the browser pane (`preview_start` with the dashboard entry from `.claude/launch.json`; create the entry if missing) and open the overview in both schemes. Expect: graphite surfaces, amber active tab, nothing blue.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/index.css apps/dashboard/src/styles/tokens.test.ts
git commit -m "feat(dashboard): console tokens for both schemes and a data palette"
```

---

### Task 2: Global primitives in `index.css`

**Files:**
- Modify: `apps/dashboard/src/index.css` ranges: `.tabs/.tab/.subtabs` 327-371, `.table-wrap/table/th/td` 456-560, `.badge*` 774-855, `.empty` 861, `.error` 905, `select` 1010-1043, `button` 1061-1100, `.chip` (filter) 1149, `.rank-badge` 1432, `.stats/.stat*` 1759-1820, `.notice-dialog` 2456, `.field` 2531, `.pager` 3352, `.signin-card` 3551, `.select-trigger/.select-pop` 6025-6100, `.tooltip` 6108
- Modify (rename call sites): `components/FavouritesFilter.tsx:20`, `features/admin/OverviewMetricsSetting.tsx:158`, `features/blackMoney/BattleDetail.tsx:117`, `features/overview/FavouritesBlock.tsx:89,96,103`, `features/planner/PlannerPage.tsx:491`, `features/schedule/ScheduleEditor.tsx:181`
- Create: `apps/dashboard/src/styles/primitives.test.ts`

**Interfaces:**
- Produces: the CSS contract `ConsoleTable` from the spec (any `table` markup gets sticky head on `--bg-top`, right-aligned `td.num`/`th.num`, vertical rules between columns, radius 0) and `.filter-chip` replacing the filter `.chip`.

- [ ] **Step 1: Write the failing test**

```ts
// primitives.test.ts
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

describe('console primitives', () => {
  it('defines .chip once, for the arena lineup, and .filter-chip for filters', () => {
    expect(css.match(/^\.chip \{/gm)?.length).toBe(1);
    expect(css).toMatch(/^\.filter-chip \{/m);
  });
  it('has no filter call site left on .chip', () => {
    const out = execSync('git grep -n "className=\\"chip\\"" -- apps/dashboard/src', { encoding: 'utf8', cwd: new URL('../../../../', import.meta.url) }).trim();
    expect(out.split('\n').filter((l) => l && !/arena\//.test(l))).toEqual([]);
  });
  it('gives thead a sticky top on the top surface', () => {
    expect(css).toMatch(/thead th \{[^}]*background: var\(--bg-top\)/);
    expect(css).toMatch(/thead th \{[^}]*position: sticky/);
  });
});
```

If `git grep` is awkward under vitest on Windows, replace that case with a `fs` walk over `src/**/*.tsx`; the assertion is the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter dashboard test -- src/styles/primitives.test.ts`
Expected: FAIL (two `.chip {` definitions, no `.filter-chip`).

- [ ] **Step 3: Restyle each primitive range in place**

Per range, under the same selectors: `.tab[aria-current="page"]` keeps the amber bottom rule and drops `text-shadow`; `table` gets `border-collapse: collapse`, `th, td` get `border-right: 1px solid var(--border)` with `:last-child` none and radius 0; `thead th` gets `position: sticky; top: 0; background: var(--bg-top); font: 500 var(--text-label)/1 var(--font-mono); letter-spacing: .1em`; `td.num, th.num` right-aligned (check how numeric cells are marked today around line 560 and keep that hook); `.badge` radius 3px, mono label font; `button` radius 3px, no transition on box-shadow; `button.primary` amber fill with `color: var(--accent-fg)` and no glow; `select`, `.select-trigger`, `.field input` radius 3px on `--bg-cell`; `.stat` loses shadow and radius, label becomes `--text-label` mono uppercase, `.stat-value` becomes `font-family: var(--font-mono); font-variant-numeric: tabular-nums` (the proportional-nums comment is retired), `.stat-hero::before` bracket removed; `.notice-dialog` radius 6px keeps `--shadow-2`; `.pager`, `.rank-badge`, `.tooltip`, `.empty`, `.error`, `.signin-card` take tokens and radius 3px. Rename the filter `.chip` block at 1149 to `.filter-chip` (and its `[aria-pressed="true"]` twin), then update the seven call sites listed in Files.

- [ ] **Step 4: Run tests and look**

Run: `pnpm --filter dashboard test -- src/styles` and `pnpm check`
Expected: PASS, biome clean. In the browser pane open a table page (Rankings), the planner and the admin page in both schemes; tables have shared borders and a sticky mono head.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/index.css apps/dashboard/src/styles/primitives.test.ts apps/dashboard/src/components/FavouritesFilter.tsx apps/dashboard/src/features
git commit -m "refactor(dashboard): console primitives; filter chips renamed off .chip"
```

---

### Task 3: Shell

**Files:**
- Modify: `apps/dashboard/src/shell.css` ranges: `.shell` 14, `.shell-sidebar` 28-97, `.shell-link` 98-135, `.shell-main/.shell-top` 202-232, `.palette` 362, `.panel/.entity` 553-575, `.strip` 631-700, `[data-theme-index="4"]` 772, `.tour` 1320

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: `.strip .stat` rules compatible with Task 4's `Cell` markup (same class names, since `StatTile` keeps emitting them).

- [ ] **Step 1: Restyle the shell**

`.shell-sidebar` background `--bg-top`, right rule `--border`; `.shell-link` radius 0, active state keeps the left rule in `--accent` and drops the `background: var(--bg-hover)` so the rule is the signal; `.shell-link[aria-current="page"] svg` colour `--accent`; `.shell-top` background `--bg-top`; `.panel, .entity` radius 0, no shadow, background `--bg-cell`; `.strip` becomes the shared-border grid (`gap: 1px; background: var(--border)` with cells on `--bg-cell`, replacing the inset-shadow trick); `[data-theme-index="4"] { --tint: var(--data-3); }`; `.palette` keeps `--shadow-2` and gets radius 6px; `.tour` takes tokens.

- [ ] **Step 2: Check**

Run: `pnpm check && pnpm --filter dashboard test`
Expected: green. Browser pane: sidebar, top bar and an entity page (alliance) in both schemes; the active nav item is an amber left rule on `--bg-top`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/shell.css
git commit -m "refactor(dashboard): console shell, strip as a shared-border grid"
```

---

### Task 4: `Cell`, `CellGrid`, `StatTile` wrapper

**Files:**
- Create: `apps/dashboard/src/components/console/Cell.tsx`, `apps/dashboard/src/components/console/CellGrid.tsx`, `apps/dashboard/src/components/console/console.css`, `apps/dashboard/src/components/console/Cell.test.tsx`
- Modify: `apps/dashboard/src/components/StatTile.tsx` (becomes a wrapper), `apps/dashboard/src/index.css` (import `./components/console/console.css` after the token blocks)

**Interfaces:**
- Produces:
  ```ts
  export type CellTone = 'up' | 'down' | 'neutral';
  export function Cell(props: {
    label: string;            // rendered uppercase mono via CSS, not transformed in JS
    value: ReactNode;         // already formatted; null renders '—'
    unit?: string;            // small mono suffix, e.g. '/204'
    context?: ReactNode;      // the line under the value
    tone?: CellTone;          // colours context only
    hero?: boolean;           // value one size up
    spark?: ReactNode;        // under context, aria-hidden
    note?: string;            // after context, muted
  }): JSX.Element;
  export function CellGrid(props: { children: ReactNode; columns?: number }): JSX.Element;
  ```
  DOM contract: `div.cell[data-hero][data-tone]` containing `.cell-label`, `.cell-value` (+ `.cell-unit`), `.cell-context`, `.cell-spark`, `.cell-note`. `CellGrid` is `div.cell-grid` with `grid-template-columns: repeat(var(--cols, auto-fit), minmax(9.5rem, 1fr))`, wrapping to 2 columns under 480px.

- [ ] **Step 1: Write the failing tests**

```tsx
// Cell.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Cell, CellGrid } from './Cell';
import { StatTile } from '../StatTile';

afterEach(cleanup);

describe('Cell', () => {
  it('renders a dash for a null value and keeps the label', () => {
    render(<Cell label="Power" value={null} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Power')).toBeTruthy();
  });
  it('puts the unit beside the value and the context under it', () => {
    const { container } = render(<Cell context="+5.31M over #2" label="Rank" unit="/204" value="#1" />);
    expect(container.querySelector('.cell-value')?.textContent).toBe('#1/204');
    expect(container.querySelector('.cell-context')?.textContent).toBe('+5.31M over #2');
  });
  it('exposes tone and hero as data attributes', () => {
    const { container } = render(<Cell hero label="Power" tone="up" value="338M" />);
    const cell = container.querySelector('.cell')!;
    expect(cell.getAttribute('data-tone')).toBe('up');
    expect(cell.hasAttribute('data-hero')).toBe(true);
  });
  it('lets a long value break instead of overflowing', () => {
    const { container } = render(<Cell label="UID" value="1171257234000576" />);
    expect(container.querySelector('.cell-value')?.className).toContain('cell-value');
    // the CSS contract: .cell-value { overflow-wrap: anywhere } — asserted in console.css test below
  });
});

describe('StatTile wrapper', () => {
  it('maps hero, note and spark onto Cell and keeps the legacy class names', () => {
    const { container } = render(<StatTile hero label="Power" note="of 204" spark={<svg />} value="338M" />);
    expect(container.querySelector('.stat.stat-hero')).toBeTruthy();
    expect(container.querySelector('.stat-note')?.textContent).toBe('of 204');
    expect(container.querySelector('.stat-spark svg')).toBeTruthy();
  });
  it('gives tone=flat no tone class', () => {
    const { container } = render(<StatTile label="Δ" tone="flat" value="0" />);
    expect(container.querySelector('.growth-up, .growth-down')).toBeNull();
  });
});

describe('CellGrid', () => {
  it('renders children inside .cell-grid', () => {
    const { container } = render(<CellGrid><Cell label="A" value="1" /></CellGrid>);
    expect(container.querySelectorAll('.cell-grid .cell').length).toBe(1);
  });
});
```

Add to `primitives.test.ts` (Task 2 file): `expect(consoleCss).toMatch(/\.cell-value \{[^}]*overflow-wrap: anywhere/)` reading `components/console/console.css`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter dashboard test -- src/components/console`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `Cell`, `CellGrid`, `console.css`, and rewrite `StatTile` as a wrapper**

`StatTile` keeps its props and emits `.stat` / `.stat-hero` / `.stat-label` / `.stat-value` / `.stat-spark` / `.stat-note` / `.growth-up` / `.growth-down` exactly as before, implemented by rendering `Cell` with `className` passthrough: simplest is for `Cell` to accept an optional `className` and `classNames` map so the wrapper can keep legacy hooks; the wrapper maps `tone: 'flat' | undefined → undefined`, `'up' → 'up'`, `'down' → 'down'`. `console.css` styles `.cell*`, `.cell-grid`, and the later kit classes; it uses only tokens.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter dashboard test && pnpm typecheck`
Expected: PASS, including every existing test that renders `StatTile` or `Strip`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console apps/dashboard/src/components/StatTile.tsx apps/dashboard/src/index.css apps/dashboard/src/styles/primitives.test.ts
git commit -m "feat(dashboard): console Cell and CellGrid; StatTile wraps Cell"
```

---

### Task 5: `Led`, `Verdict`, `Chip`, `Ticks`

**Files:**
- Create: `components/console/Led.tsx`, `components/console/Verdict.tsx`, `components/console/Chip.tsx`, `components/console/Ticks.tsx`, `components/console/kit.test.tsx`
- Modify: `components/console/console.css`

**Interfaces:**
- Produces:
  ```ts
  export function Led(props: { tone: 'ok' | 'bad' | 'warn' | 'neutral'; children: ReactNode; title?: string }): JSX.Element;
  // span.led[data-tone] > span.led-dot(aria-hidden) + text

  export function Verdict(props: { children: ReactNode }): JSX.Element;
  // p.verdict; callers wrap figures in <code> which console.css styles amber-on-wash

  export function Chip(props: { icon?: ReactNode; label: string; figure?: ReactNode; suffix?: string; title?: string }): JSX.Element;
  // span.chip-console > .chip-icon? .chip-label .chip-figure? .chip-suffix?   (NOT .chip: that is the arena lineup)

  export interface Tick { key: string; label: string; value: ReactNode; share?: number; rank?: number; rankOf?: number; delta?: ReactNode; }
  export function Ticks(props: { items: readonly Tick[]; ariaLabel: string }): JSX.Element;
  // ul.ticks > li.tick[style=--w:<share%>][data-top] > .tick-rank? .tick-value .tick-label (+ share text) .tick-delta?
  // rank 1 → data-top → amber-filled rank badge; share undefined → no --w, no percent text
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
// kit.test.tsx
describe('Led', () => {
  it('carries its tone and hides the dot from assistive tech', () => {
    const { container } = render(<Led tone="bad">SHIELD OFF 7d</Led>);
    expect(container.querySelector('.led')?.getAttribute('data-tone')).toBe('bad');
    expect(container.querySelector('.led-dot')?.getAttribute('aria-hidden')).toBe('true');
  });
});
describe('Verdict', () => {
  it('renders one paragraph with inline code figures', () => {
    const { container } = render(<Verdict>#1 on 576 by <code>5.31M</code>.</Verdict>);
    expect(container.querySelectorAll('p.verdict').length).toBe(1);
    expect(container.querySelector('p.verdict code')?.textContent).toBe('5.31M');
  });
});
describe('Chip', () => {
  it('does not use the arena .chip class', () => {
    const { container } = render(<Chip figure={750} label="Orange hero shard" suffix="d5–6 500" />);
    expect(container.querySelector('.chip')).toBeNull();
    expect(container.querySelector('.chip-console .chip-figure')?.textContent).toBe('750');
  });
});
describe('Ticks', () => {
  const items = [
    { key: 'hero', label: 'heroes', value: '104M', share: 0.31, rank: 2 },
    { key: 'tech', label: 'tech', value: '67.0M', share: 0.2, rank: 1, delta: '+1.21M' },
    { key: 'troops', label: 'troops', value: '375M' },
  ];
  it('marks rank 1 as top and sets the bar width from share', () => {
    const { container } = render(<Ticks ariaLabel="Composition" items={items} />);
    const ticks = container.querySelectorAll('li.tick');
    expect(ticks[1].hasAttribute('data-top')).toBe(true);
    expect(ticks[0].hasAttribute('data-top')).toBe(false);
    expect((ticks[0] as HTMLElement).style.getPropertyValue('--w')).toBe('31%');
  });
  it('renders no percent and no width for an item without share', () => {
    const { container } = render(<Ticks ariaLabel="Composition" items={items} />);
    const troops = container.querySelectorAll('li.tick')[2] as HTMLElement;
    expect(troops.style.getPropertyValue('--w')).toBe('');
    expect(troops.textContent).not.toMatch(/%|NaN/);
  });
  it('omits the rank badge when rank is undefined', () => {
    const { container } = render(<Ticks ariaLabel="Composition" items={items} />);
    expect(container.querySelectorAll('li.tick')[2].querySelector('.tick-rank')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter dashboard test -- src/components/console/kit.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the four components and their CSS**

`Led` dot: 7px circle, `background: var(--ok|--bad|--accent|--fg-muted)` by tone, `box-shadow: var(--led-glow-<tone>)`, none for neutral; text in `--font-mono` at `--text-label` size. `Verdict code`: `--accent` on `--accent-wash`, radius 3px, mono. `Ticks`: `li.tick` with `border-top: 2px solid var(--border)` and `::before` of width `var(--w, 0)` in `--accent`; `.tick-rank` is `--bg-raised` text `--fg`, and `[data-top] .tick-rank` is amber fill with `--accent-fg`. Grid of 5 columns above 480px, stacked below. Share text is `Math.round(share * 100) + '%'` only when `share` is a finite number.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter dashboard test -- src/components/console && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console
git commit -m "feat(dashboard): console Led, Verdict, Chip and Ticks"
```

---

### Task 6: `StepTable`

**Files:**
- Create: `components/console/StepTable.tsx`, `components/console/StepTable.test.tsx`
- Modify: `components/console/console.css`

**Interfaces:**
- Produces:
  ```ts
  export interface StepColumn<Row> { key: string; header: ReactNode; cell: (row: Row) => ReactNode; numeric?: boolean; }
  export function StepTable<Row>(props: {
    columns: readonly StepColumn<Row>[];
    rows: readonly Row[];
    rowKey: (row: Row) => string;
    total?: Row;                 // rendered as tr.step-total in --bg-raised with amber figures
    foldAt?: number;             // default 20; rows beyond are hidden behind "Show all N" until clicked
    caption?: string;
  }): JSX.Element;
  // table.step-table; numeric columns get th.num / td.num; fold control is button.step-fold
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
const cols = [
  { key: 'step', header: 'HQ', cell: (r: Row) => r.step },
  { key: 'wood', header: 'Wood', cell: (r: Row) => r.wood, numeric: true },
];
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ step: `${i} → ${i + 1}`, wood: `${i}M` }));

it('shows every row and no fold control at exactly the threshold', () => {
  const { container } = render(<StepTable columns={cols} foldAt={5} rowKey={(r) => r.step} rows={rows(5)} />);
  expect(container.querySelectorAll('tbody tr').length).toBe(5);
  expect(container.querySelector('.step-fold')).toBeNull();
});
it('folds past the threshold and unfolds on click', () => {
  const { container } = render(<StepTable columns={cols} foldAt={5} rowKey={(r) => r.step} rows={rows(6)} />);
  expect(container.querySelectorAll('tbody tr').length).toBe(5);
  fireEvent.click(container.querySelector('.step-fold')!);
  expect(container.querySelectorAll('tbody tr').length).toBe(6);
  expect(container.querySelector('.step-fold')).toBeNull();
});
it('renders the total row last with the numeric class', () => {
  const { container } = render(<StepTable columns={cols} rowKey={(r) => r.step} rows={rows(2)} total={{ step: 'Total', wood: '1M' }} />);
  const last = container.querySelector('tbody tr:last-child, tfoot tr')!;
  expect(last.className).toContain('step-total');
  expect(last.querySelector('td.num')?.textContent).toBe('1M');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter dashboard test -- src/components/console/StepTable.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `StepTable`**

Total row goes in `<tfoot>`. Fold state is local `useState(false)`; the control text is `Show all {rows.length}`. CSS: `tfoot td { background: var(--bg-raised); color: var(--accent); font-weight: 600 }`, numeric cells `font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter dashboard test && pnpm typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console
git commit -m "feat(dashboard): console StepTable with fold and total row"
```

---

### Task 7: Hardcoded colour sweep, map ours colour

**Files:**
- Modify: `apps/dashboard/src/index.css`, `apps/dashboard/src/shell.css` (per-feature blocks), `apps/dashboard/src/features/map/atlas.ts:92`
- Modify: `apps/dashboard/src/styles/tokens.test.ts` (extend)

- [ ] **Step 1: Measure**

Run from `apps/dashboard/src`:
```bash
grep -nE "#[0-9a-fA-F]{3,8}\b" index.css shell.css | grep -vE "^\S+:(2[5-9]|[3-9][0-9]|1[0-9]{2}|2[0-3][0-9]):|--ink-|--chart-|--data-" | wc -l
```
Record the number in the PR body as the before count.

- [ ] **Step 2: Extend the test**

Add to `tokens.test.ts`: read `features/map/atlas.ts` and assert `OURS_COLOR` is not a hex literal (`expect(src).toMatch(/OURS_COLOR = 'var\(--accent\)'|OURS_COLOR = accentColor\(\)/)`), choosing whichever the map's canvas code can consume (if the canvas needs a resolved hex, read it from `getComputedStyle(document.documentElement).getPropertyValue('--accent')` once at paint time).

- [ ] **Step 3: Sweep**

Replace every surface, rule, text, accent and status literal in per-feature CSS with the token it means; point categorical uses (`--cal-*`, hero-grade chips, tier rows) at `--data-*` or `--tier-*`; leave `--ink-*` alone. Change `OURS_COLOR` per Step 2. Re-run the Step 1 command; the remaining literals must each be one of: an `--ink-*`, a chart or data token value, or a colour inside a comment.

- [ ] **Step 4: Run everything**

Run: `pnpm check && pnpm typecheck && pnpm test && pnpm build`
Expected: green; the build must not warn about CSS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src
git commit -m "refactor(dashboard): hardcoded colours onto console tokens; map ours colour is the accent"
```

---

### Task 8: Screenshot checklist and PR

**Files:**
- Modify: `.claude/launch.json` only if Task 1 had to add the dashboard entry
- PR body

- [ ] **Step 1: Run the copycat checklist in the browser pane**

With the dev server running, for each of: player page, alliance page, rankings table, planner; in dark then light (`resize_window` with `colorScheme`), at desktop and at 320px wide: take a screenshot and check: no navy or cyan; no glow except LEDs; no card floating on a shadow; no pill chips; labels mono uppercase; figures tabular mono; grid cells share borders; nothing overflows at 320px. Fix anything that fails and re-check.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin feature-layout-additions-e9c1b6
gh pr create --title "feat(dashboard): console visual system and kit" --body-file <(cat <<'EOF'
## What
Site-wide console restyle (tokens for both schemes, data palette, primitives, shell) and the console kit: Cell/CellGrid, Led, Verdict, Chip, Ticks, StepTable. StatTile wraps Cell; no call site changed.

## Checklist (spec §Review checklist), per page × scheme × width
- player / alliance / rankings / planner: dark, light, 320px — [pass/fail each]

## Hardcoded colour literals outside token blocks
before: N → after: M (remaining are --ink-* and comments)

## Not in this PR
Per-feature console composition (four sibling PRs), @dw/ui/map.css.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

Then bind the PR with `mcp__ccd_pr__get_status` / `bind_pr` and read CI. Merging publishes cbfw.us; the user looks at the live site within minutes of merge.

- [ ] **Step 3: Message the four feature sessions once merged**

After merge to `main`, send each linked session (`player-profile`, `alliance-page`, `event-guide`, `calculator-ref`) one message: foundation merged; rebase onto `main`; start phase B per your spec using `components/console`.
