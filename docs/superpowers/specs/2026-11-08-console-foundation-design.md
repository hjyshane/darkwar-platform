# Console foundation — design

Date: 2026-11-08. Status: draft for builder check.
Sibling specs that depend on this one: player profile, alliance page, event
guide framework, calculator reference mode (all dated 2026-11-08).

## Intent

cbfw.us moves to one visual system, called **console** here: a graphite grid
with shared borders, amber as the single accent, status LEDs, monospace
labels, dense tabular figures. It replaces the current Linear-style neutral
look (floating cards, blue accent) across the whole site in one pass, so
the four feature projects that follow build on it instead of each inventing
a dialect.

The information design the user liked on a competitor's site is kept: a
one-line verdict at the top of an entity page, a context line under every
number ("#3 · 51.6K to #2"), composition shown with rank per board, reward
chips, step tables with a total row. The *visual* language is deliberately
different: no navy, no cyan, no glow, no rounded floating cards, no pills.
The user's words: liked the UI/UX, does not want the same vibe.

## Goals

- One token set and one small component kit that every page uses.
- Whole site reads as console after this PR merges: shell, tabs, tables,
  badges, buttons, selects, stat tiles, panels, strips, dialogs, pager,
  empty and error states.
- Light and dark both real, as today. Dark is the design's home; light is a
  paper grid with the same structure.
- No page loses function or data. This is a restyle plus a kit, not a
  rewrite of any feature.

## Non-goals

- Changing information architecture, routes, or navigation structure.
- Touching per-feature layout beyond what the token swap and primitive
  restyle produce. Feature pages get their console *composition* in their
  own projects.
- New data, new migrations, new RPCs. This PR is dashboard-only.

## Anti-goals

- Looking like the competitor. Review checklist below is the test.
- A half-migrated site where some pages are console and others are not.
  Everything global goes in one PR.
- Breaking contrast in light mode. Every token pair is checked against
  WCAG AA for its own scheme.

## The system

### Tokens (replace the current values in `apps/dashboard/src/index.css`)

Dark (home scheme):

- Surfaces: page `#15161a`, cell `#1a1b20`, raised `#1f2026`, top bar and
  table head `#121317`.
- Rules: `#2c2e34`, strong `#3a3d45`.
- Text: `#e8e6e1`, muted `#8d8f96`.
- Accent: amber `#e0b452`; on-amber text `#15161a`; amber wash `#2a2415`.
- Status: ok `#6cc38a`, bad `#e07070`, warn amber. LED glow is
  `0 0 6px <colour>`, the only glow in the system, and only on LEDs.
- Existing semantic pairs (`--ok-bg/fg`, `--warn-*`, `--danger-*`,
  `--info-*`, `--neutral-*`, `--tier-*`) stay as names; values move to the
  graphite palette. `--gold*` becomes an alias of amber so existing gold
  usage (rank medals, primary CTA, active tab) turns amber for free.
- `--accent` becomes amber. The blue `#7aa2f7` / `#1d4ed8` is retired as
  *chrome*: accent, focus ring, links, active states, primary buttons.
  Grep must show zero remaining uses in chrome tokens after the PR. Where
  the same hex appears as a *data* colour it is handled by the data
  palette below, not by the chrome rule.
- `--info-*` becomes a cool neutral, not navy: dark `#1e242c` / `#9fb0c3`,
  light `#e6ebf1` / `#334155`. It stays a distinct family from `--neutral-*`
  (badge-info, category chips and the two callouts keep reading as
  "information", which is a different message from "no status").

### Data colours (categorical; chrome rules do not apply)

Tiers, chart series, guide-week tints, map "ours" and anything else that
distinguishes *categories of data* use one categorical palette defined in
this PR, six steps, muted so none of them reads as the accent and none is
the competitor's cyan or navy: amber `#e0b452` (series 1, also "ours"),
sage `#8fb38a`, steel `#7f98b3`, clay `#c48a6a`, plum `#a48bb8`, slate
`#8d8f96`. Light scheme darkens each by one step for text use. Rules:

- `--chart-1..6` map onto these in order. `--chart-4`'s current `#a16207`
  is replaced, so a series never collides with accent highlights.
- `--tier-*` pairs are rebuilt from the palette: backbone steel, elite
  clay, advanced plum, commander amber-on-dark. Four distinguishable hues,
  none navy. Tier badges therefore pass the checklist on the table page.
- Guide-week tint 4 takes steel. Map `OURS_COLOR` in
  `features/map/atlas.ts` takes amber (ours = accent is consistent with
  the rest of the site). `@dw/ui/map.css` fallbacks are out of scope: that
  file is shared with the desktop app and gets its own pass.
- `--ink-blue` and the other writer-chosen rich-text ink colours are
  content, not chrome. They are left exactly as they are so stored posts
  render as their authors saw them.

Light (paper grid): page `#f4f3ef`, cell `#ffffff`, raised `#faf9f6`, top
bar `#ecebe6`, rules `#d9d7cf` / `#bdbbb2`, text `#17181a` / `#686a70`,
amber darkens to `#955a06` for text and borders (measured: 4.5+ on every
light surface it sits on; `#a16207` only cleared white) and
stays `#e0b452` only as a fill behind dark text. Status greens and reds use
their existing light-scheme values.

Type:

- `--font-sans` stays system (Inter if the repo already ships it; builder
  checks, do not add a webfont request for this).
- `--font-mono` is used for every figure, every small uppercase label, LED
  text, chip text, table body cells with numbers. `font-variant-numeric:
  tabular-nums` on all of them.
- Label scale: `--text-label` 10px, letter-spacing `.1em`, uppercase, mono,
  muted. This is the console signature and replaces the current
  `.stat-label` style.

Shape and depth:

- Radii: cells and tables 0; chips, LEDs' pills, buttons 3px; dialogs 6px.
  `--radius-lg` and `--radius-pill` stop being used by global primitives.
- No box shadows on surfaces. `--shadow-1/2` kept only for the dialog and
  the command palette.
- Depth comes from shared borders: adjacent cells share one 1px rule.

### Kit (new, under `apps/dashboard/src/components/console/`)

Each is a small presentational component with a test for its rendering
contract, no data fetching. Names are fixed so the four feature specs can
reference them.

- `Verdict` — one paragraph, 15px, with `<code>`-styled inline figures in
  amber wash. Takes children; feature pages compose the sentence.
- `CellGrid` and `Cell` — the stat strip. `Cell` takes `label`, `value`,
  optional `unit`, optional `context` with a `tone` of up/down/neutral,
  optional `hero` (the value steps up one size; `Strip` keeps making its
  first cell the hero), optional `spark` (a slot for the existing
  `Sparkline`, drawn under the context line), optional `note`. Figures are
  mono tabular at every size. `StatTile` (103 call sites) becomes a thin
  wrapper over `Cell` that maps its props one-to-one, so no call site
  changes in this PR. `CellGrid` lays cells in a bordered row that wraps
  to two rows below 720px wide and to a 2-column grid below 480px.
- `Led` — dot plus mono text, tone ok/bad/warn/neutral. Used for shield,
  online, data freshness, capture state.
- `Ticks` — composition. Takes an ordered list of `{label, value, share,
  rank, rankOf, delta}` and draws the tick-bar-per-item with the rank badge
  (amber fill when rank is 1). Replaces five identical tiles.
- `Chip` — item or reward chip: optional 12px icon, label, mono figure,
  optional muted suffix. Square corners.
- `StepTable` — generic step table: columns declared by the caller, body
  rows in mono tabular, optional `total` row rendered in the raised surface
  with amber figures, optional "show all N" fold when rows exceed a
  threshold.
- `ConsoleTable` wrapper rules — not a component; a CSS contract that
  existing `table` markup picks up automatically: sticky head on
  `#121317`, right-aligned numeric cells, vertical rules between columns.

### Global primitives to restyle (existing class names, same markup)

From the survey of `index.css` and `shell.css`: `.tabs/.tab/.subtabs`,
`table/th/td/.table-wrap/.toolbar`, `.badge*`, `select`, `button`,
`button.primary`, `.stats/.stat*` (becomes a thin alias of `Cell`), `.empty`,
`.error`, `.rank-badge`, `.notice-dialog`, `.field`, `.pager`,
`.signin-card`, `.select-trigger/.select-pop`, `.tooltip`, `.shell*`,
`.palette`, `.panel`, `.entity`, `.strip`, `.tour`.

Known trap: `.chip` is defined twice (filter chip at ~1149, hero chip at
~1617). Rename the filter one to `.filter-chip` as part of this PR and
update its call sites; the kit's `Chip` is a React component with its own
class, so no third collision.

Per-feature CSS that hardcodes a colour (grep `#[0-9a-f]{3,6}` outside the
token blocks; 284 literals today) gets swept to tokens in this PR when it
is a surface, rule, text, accent or status colour. Categorical uses are
pointed at the data palette above. Rich-text ink colours are left alone.

### Review checklist (the copycat test)

Before the PR is marked ready, a screenshot of the player page, the
alliance page, a table page and the planner, in both schemes, is checked
against: no navy or cyan anywhere; no glow except LEDs; no card floating on
a shadow; no pill-shaped chips; labels are mono uppercase; figures are
tabular mono; grid cells share borders. If the four screenshots could be
mistaken for the competitor, the PR is not done.

## Constraints

- Dashboard only. No migration, no collector change.
- `pnpm check && pnpm typecheck && pnpm test && pnpm build` green. The
  existing component tests under `components/ui` keep passing.
- Visual regression: Playwright is deferred in this repo, so the check is
  the screenshot set above, attached to the PR.
- Merging to `main` publishes cbfw.us. This PR is a visible release; the
  user should expect to look at it on the live site within minutes of
  merge, and roll back by revert if something is unreadable.

## Order of work (suggested, builder may change)

1. Tokens and both schemes; nothing else. Look at the site.
2. Global primitives.
3. Kit components with tests.
4. Hardcoded-colour sweep.
5. Screenshot set, checklist, PR.

## Left to the builder

- Exact spacing scale inside cells; the mockup used 12px/16px padding.
- How the sidebar's active state reads in console (amber left rule is the
  obvious answer).
- Whether `StatTile` (existing component) is deleted or becomes a wrapper
  over `Cell`. Prefer wrapper if more than a handful of call sites.
- Reduced-motion behaviour for the LED glow (likely: no animation at all,
  so nothing to reduce).

## Decided by Claude, user can override

- Light mode uses a dark gold `#955a06` for amber text so
  contrast holds. Mockup showed dark only.
- Radii drop to near zero site-wide. The mockup implied it; stating it.
- `--gold` aliases amber rather than coexisting. One accent.
- "One accent" governs chrome only. Data gets a six-step categorical
  palette, because tiers, chart series and map ownership must stay
  distinguishable, and the copycat test is about chrome.
- `--info-*` is a cool neutral rather than being folded into
  `--neutral-*`, so no badge family disappears.
- `Cell` carries `hero`, `spark` and `note` so `StatTile` can wrap it
  faithfully; otherwise every page header would change shape in a PR that
  promises not to touch feature layout.
