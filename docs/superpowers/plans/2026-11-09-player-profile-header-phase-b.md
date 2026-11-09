# Player Profile Header — Phase B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the player page's header and stat strip with the spec's five sections (identity row with LEDs, verdict, cells, composition ticks, arena lineups) on the console kit.

**Architecture:** Three layers. `headerModel.ts` is a pure function from already-fetched rows to a display model (strings, tones, ticks) and carries all the wording and thresholds, so it is fixture-tested without React. `ProfileHeader.tsx` is presentational: model in, kit components out, no fetching. `useProfileHeader.ts` runs the phase A queries and calls the model builder; `PlayerPage.tsx` swaps its old header for the new one and keeps everything below the tabs untouched.

**Tech Stack:** React 18, React Query, Vitest + Testing Library, the console kit in `apps/dashboard/src/components/console/`, tokens from `apps/dashboard/src/index.css`.

**Spec:** `docs/superpowers/specs/2026-11-08-player-profile-design.md` (sections 1 to 5, "UI work (phase B)"); kit and tokens per `docs/superpowers/specs/2026-11-08-console-foundation-design.md`.

## Global Constraints

- Tokens only: no colour literal in any rule added. Feature CSS is imported from the component (`profileHeader.css` from `ProfileHeader.tsx`), never from `index.css`.
- Copycat test for every surface added: no navy or cyan, no glow except LEDs, no card on a shadow, no pills, labels mono uppercase, figures tabular mono, cells share borders.
- English UI only. No RLS change, no migration (0313 to 0316 are spoken for; this phase adds none).
- A fact appears only when its data exists: clauses, ticks, the lineup section and contexts are dropped, not filled. Unknown is a dash, never zero.
- Delta window is always written out: `30d` for own-alliance members, `7d` otherwise; `as of {date}` when there is no older row.
- Shield clause and shield LED treat a map read older than 7 days as no read.
- Data LED warns when the newest power reading is older than 48h.
- Diffs stay in `apps/dashboard/src/features/player/`, `apps/dashboard/src/dev/fixtures.ts` and the plan doc. `lib/route.ts`, nav and shared components are not edited.
- Gates before pushing: `pnpm check && pnpm typecheck && pnpm test && pnpm build`.

## Rulings against the spec (reported in the PR)

1. **No "delta to the neighbour" on ranked ticks.** Phase A holds no neighbour power per board, and reading it means guessing how `rank.get.by.range` pages share an observation. Ticks show value, share and rank; the delta waits for a query proven on real data.
2. **Position keeps the inline map.** The coordinate stays the button that opens the player's own marker map (today's behaviour); the context line carries the `mapHash()` link to the server map. Linking the coordinate itself would lose the marker.
3. **Coordinate is written as the game writes it** (`491, 444`, `formatCoordinate`), not `x·y`.
4. **Board rows come from the page's existing fetch**, not a second request: `fetchBoardRows` is removed and `PlayerDetail` carries the rows it already reads.
5. **LEDs wrap under the name below 480px** rather than collapsing to icons (spec left it to the builder).

## Review Focus

1. A player we know only by name (no power, no rank, no map read, no boards, no arena): header renders name, three neutral LEDs, six cells of dashes, no verdict, no ticks, no lineup section (Task 1, Task 2).
2. Power of thirteen digits in the hero cell at 320px: the value must not push the grid sideways (Task 3, preview check).
3. A viewer who cannot read the roster history: sixth cell is HQ level, not an error (Task 1).
4. Shield read 9 days old with the shield "down": LED is neutral "no map read", not red (Task 1).
5. A player on four arena boards: three rows and the link to the Arena tab (Task 2).

---

### Task 1: `headerModel.ts`

**Files:**
- Create: `apps/dashboard/src/features/player/headerModel.ts`
- Create: `apps/dashboard/src/features/player/headerModel.test.ts`

**Interfaces:**
- Consumes (phase A): `ServerRankFacts`; `composeVerdict`, `VerdictSegment`; `composeBoards`, `rankedBoards`, `BoardRow`; `retentionWindowDays`, `powerDelta`, `killsDelta`, `HistoryRow`, `Delta`; `tenureCell`; `arenaSummary`; `PlayerLocation`, `stateOf` from `playerLocation.ts`; `formatAge`, `formatLastOnline` from `lib/freshness.ts`; `compactNumber`; `Tick`, `CellTone`, `LedTone` from the kit.
- Produces:
  ```ts
  export const DATA_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
  export interface HeaderPlayer { serverId: number; hqLevel: number | null; power: number | null; kills: number | null; isOwnAlliance: boolean; onlineState: string | null; offlineSince: string | null; observedAt: string | null; powerAt: string | null }
  export interface HeaderInputs { player: HeaderPlayer; rank: ServerRankFacts | null; location: PlayerLocation | null; boardRows: readonly BoardRow[]; history: readonly HistoryRow[]; firstSeenInAlliance: string | null; arena: readonly PlayerArenaEntry[]; now: Date }
  export interface LedModel { key: 'shield' | 'online' | 'data'; tone: LedTone; text: string; title: string }
  export interface CellModel { label: string; value: string | null; unit?: string; context?: string; tone?: CellTone }
  export interface PositionModel extends CellModel { serverId: number | null; stale: boolean }
  export interface HeaderModel { leds: LedModel[]; verdict: VerdictSegment[]; power: CellModel; rank: CellModel; position: PositionModel; kills: CellModel; lastSeen: CellModel; sixth: CellModel; ticks: Tick[]; boardsAsOf: string | null; lineups: PlayerArenaEntry[] }
  export function buildHeaderModel(inputs: HeaderInputs): HeaderModel
  ```
- Wording fixed here (tests pin it): shield LED `SHIELD 5h` / `SHIELD 45m` / `SHIELD 3d` (ok), `SHIELD OFF 7d` / `SHIELD OFF 5h` / `SHIELD OFF` (bad), `NO MAP READ` (neutral); online LED `ONLINE` (ok), `SEEN 3h ago` / `OFFLINE` / `PRESENCE UNKNOWN` (neutral); data LED `DATA 5h ago` (ok), `DATA 3d ago` (warn), `NO POWER READ` (neutral). Power and kills contexts `+59.4M · 30d`, `-1.2M · 7d`, `0 · 7d`, `as of 2026-11-08`. Rank value `#12`, unit `/900`, context `1.2M to #11`, at rank 1 `59.4M over #2`. Sixth cell `In alliance` `45d` with context `since 2026-09-24`, else `HQ level`.

- [ ] **Step 1: Write the failing tests** (`now = 2026-11-08T12:00:00Z`): one `describe` per part — leds (the nine wordings above, plus the 9-day-old read), cells (own vs other window, `asOf`, no history, rank mid / top / none, position known / stale / unknown, sixth tenure / hq / neither), ticks (labels, compact values, share omitted when the sum fails, rank only on hero and pet, `boardsAsOf`), verdict wiring (rank + shield + boards in one sentence), and a `minimal` case asserting dashes and empties.
- [ ] **Step 2: Run** `pnpm --filter @dw/dashboard exec vitest run src/features/player/headerModel.test.ts` → fails, module missing.
- [ ] **Step 3: Implement** `buildHeaderModel` as small builders (`shieldLed`, `onlineLed`, `dataLed`, `deltaCell`, `rankCell`, `positionCell`, `sixthCell`, `ticksOf`).
- [ ] **Step 4: Run** the test → pass.
- [ ] **Step 5: Commit** `feat(player): header display model from phase A facts`.

### Task 2: `ProfileHeader.tsx` + `profileHeader.css`

**Files:**
- Create: `apps/dashboard/src/features/player/ProfileHeader.tsx`
- Create: `apps/dashboard/src/features/player/profileHeader.css`
- Create: `apps/dashboard/src/features/player/ProfileHeader.test.tsx`
- Create: `apps/dashboard/src/features/player/profileHeader.css.test.ts`

**Interfaces:**
- Consumes: `HeaderModel` (Task 1); kit `Verdict`, `CellGrid`, `Cell`, `Led`, `Ticks`; `LineupCell`; `FreshnessBadge`; `leagueLabel`; `serverHash`, `allianceHash`, `mapHash`.
- Produces:
  ```ts
  export interface ProfileHeaderProps {
    name: string; gameUid: number; serverId: number;
    alliance: { id: string; code: string | null; name: string | null } | null;
    hqLevel: number | null; lastSeenAt: string | null;
    model: HeaderModel;
    favourite?: ReactNode;
    onToggleMap?: () => void; mapOpen?: boolean; mapSlot?: ReactNode;
    onShowArena?: () => void;
    now?: Date;
  }
  export function ProfileHeader(props: ProfileHeaderProps): JSX.Element
  ```
- Markup contract (tests pin it): one `section.entity.profile-header[aria-labelledby="player-heading"]`; `h2#player-heading`; `.profile-leds` with three `.led`; `p.verdict` only when the model has segments, figures in `<code>`; `.profile-cells .cell` × 6, the first `data-hero`; `ul.ticks[aria-label="Power composition"]` only with ticks; `.profile-lineup` × up to 3 with `Seen in arena · {date}`; a `button.linklike` "All arena entries" calling `onShowArena`; the position context holds `a[href="#/map/{serverId}"]`; `p.entity-foot` with the UID.
- CSS: identity row is a wrapping flex; cell grid is 7 tracks from 1100px (power spans 2), 3 tracks below (power spans 3, last spans 2), 2 tracks under 480px (power and last span 2), so no leftover slot at any width; the grid's side borders are dropped because the section already draws them.

- [ ] **Step 1: Write the failing tests** — `minimal data` (name only) and `full data` renders per the contract above, with `LineupCell` mocked to a stub; `profileHeader.css.test.ts` reads the stylesheet and asserts no `#hex`/`rgb(`/`hsl(` literal, no `box-shadow`, no `border-radius` other than `var(--radius-md)`.
- [ ] **Step 2: Run** both → fail, modules missing.
- [ ] **Step 3: Implement** component and stylesheet.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(player): profile header on the console kit`.

### Task 3: Wire into the page

**Files:**
- Create: `apps/dashboard/src/features/player/useProfileHeader.ts`
- Modify: `apps/dashboard/src/features/player/PlayerPage.tsx` (header block and `PlayerDetail`)
- Modify: `apps/dashboard/src/features/player/composition.ts` (remove `fetchBoardRows`)
- Modify: `apps/dashboard/src/features/player/serverRank.tsx` (remove the now unused tile)
- Modify: `apps/dashboard/src/dev/fixtures.ts` (seed the new query keys for the look-around build)

**Interfaces:**
- Produces: `useProfileHeader(source: HeaderSource, now?: Date): HeaderModel`, where `HeaderSource = HeaderPlayer & { playerId: string; allianceId: string | null; boardRows: BoardRow[]; arena: PlayerArenaEntry[] }`. Query keys: `['player-server-rank', playerId]` (exists), `['player-location', playerId]` (exists), `['player-history-window', playerId, windowDays]`, `['player-first-seen', playerId, allianceId]` (enabled only with an alliance). While a query is pending its fact is absent, so the header fills in rather than blocking.
- `PlayerDetail` gains `boardRows: BoardRow[]` (the rows the component query already returns) and `observedAt` is already there.

- [ ] **Step 1:** Add `boardRows` to `fetchPlayer`'s return; write `useProfileHeader`; replace the `<section className="entity">` block with `<ProfileHeader …>` passing the favourite button, the map toggle, and `PlayerLocationNote` + `PlayerLocationMap` as `mapSlot` when open; remove the unused tile imports.
- [ ] **Step 2:** Seed fixtures for the four keys and `boardRows` so `index.dev.html#/player/<id>` shows a full header and a second player shows the minimal one.
- [ ] **Step 3: Run** `pnpm check && pnpm typecheck && pnpm test` → green.
- [ ] **Step 4: Commit** `feat(player): the page reads through the new profile header`.

### Task 4: Look at it, gate, PR

- [ ] Preview `index.dev.html#/player/<id>` in dark, light and at 320px: full and minimal players. Check the copycat list; fix what fails.
- [ ] `pnpm check && pnpm typecheck && pnpm test && pnpm build`.
- [ ] Push `player-profile-header-ui`; `gh pr create --draft --base player-profile-header-d56681`; body lists the rulings above, the gate results, screenshots taken, and what could not be checked signed in (real queries, RLS fallbacks, icons).
