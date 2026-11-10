# Alliance Page Phase B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the alliance page its first-screen reading (LEDs, verdict, cell grid), the alliance's own words with allied tags as links, and a movement feed (newest five on Overview, a paged Moves tab), all on the console kit.

**Architecture:** Dashboard only. Pure functions decide every figure and sentence (`header.ts`, `verdict.ts`); small presentational components render them on the kit (`AllianceHeader`, `AllianceIntro`, `AllianceMoves`); `AlliancePage.tsx` keeps its one detail query and mounts the new pieces. New data comes from phase A's `alliance_info_latest` and `alliance_moves` plus views that already exist (`alliance_latest`, `alliance_power_history`). No role logic in the page: the view and the RPC already decided what the caller sees.

**Tech Stack:** React 19, TanStack Query, vitest + Testing Library, the console kit in `apps/dashboard/src/components/console/`.

**Spec:** `docs/superpowers/specs/2026-11-08-alliance-page-design.md` (phase B sections), `docs/superpowers/specs/2026-11-08-console-foundation-design.md`.

## Global Constraints

- No migration, no collector change. 0312, 0315, 0316 are spoken for; none is needed.
- Tokens only: no colour literal in any rule. Feature CSS lives in `features/alliance/alliance.css`, imported from the components that use it, never from `index.css`.
- Copycat test: no navy or cyan, no glow except `Led`, no card on a shadow, no pills, labels mono uppercase, figures tabular mono, cells share borders.
- Filter chips are `.filter-chip` with `aria-pressed`. `.chip` is the arena lineup. The kit's chip is `.chip-console`.
- English UI only.
- Membership for our alliance comes from `alliance_roster_latest` (the page's existing detail query); never `players.current_alliance_id` for a count that claims to be current.
- `join_approval` meaning is unconfirmed: the cell is labelled `Join (raw)` and shows the raw integer; the verdict carries no join sentence (`joinRuleOf` returns null).
- Moves visibility is the RPC's. The page only words the empty state.
- Diff stays in `features/alliance/`, `lib/route.ts` (one new view id), `lib/shellNav.tabs.test.ts`, `dev/fixtures.ts`, and this plan.

## Review Focus

1. An alliance with no `get.al.info` card (most strangers): header must still render power, members and rank, with dashes for join, minimums and language, and no intro panel — Task 2 test "renders without an info card".
2. A roster capture older than 48h must warn, and a cut-short capture must read bad, independently — Task 1 tests for `rosterLed` and `captureLed`.
3. Power history with no reading 7 days back must give no delta rather than a delta against the oldest row — Task 1 test "no reading old enough".
4. An intro whose ally tag is unknown stays text, and a tag never links across servers — Task 3 render test.
5. Zero moves for one of our alliances must say who the feed is for, not "nobody moved" — Task 4 test "own alliance empty state".

---

### Task 1: `header.ts` — the header's facts as pure functions

**Files:** Create `features/alliance/header.ts`, `header.test.ts`.

**Interfaces (produces):**
- `ROSTER_WARN_HOURS = 48`
- `interface LedFact { tone: LedTone; text: string; title: string }`
- `rosterLed(capturedAt: string | null, now: Date): LedFact | null` — null without a roster capture; `ok` `ROSTER 3h` under 48h; `warn` `ROSTER 3d` at or past it. Age text via `lib/freshness` `formatAge` stripped of " ago", upper-cased by CSS.
- `captureLed(membersFrom: 'roster' | 'last known', complete: boolean): LedFact | null` — null for `last known`; `ok` `CAPTURE COMPLETE`; `bad` `CAPTURE CUT SHORT`.
- `interface PowerReading { captured_at: string | null; power: number | null }`
- `powerDelta(readings: readonly PowerReading[], now: Date, days = 7): number | null` — newest non-null power minus the newest non-null reading at or before `now - days`; null when either is missing.
- `signedCompact(value: number): string` — `+1.2G`, `-340M`, `0`.
- Query functions (thin, untested): `fetchStanding(serverId): Promise<StandingRow[]>` from `alliance_latest` (`alliance_id, power, code`, `eq server_id`); `fetchPowerReadings(allianceId): Promise<PowerReading[]>` from `alliance_power_history` (`captured_at, power`, newest 200); `fetchLeader(gameUid): Promise<{ playerId: string; name: string | null } | null>` from `players`.

- [ ] Tests: `rosterLed` null / ok at 47h / warn at 48h; `captureLed` three cases; `powerDelta` +, −, "no reading old enough" → null, ignores null powers, unordered input; `signedCompact` three cases.
- [ ] FAIL → implement → PASS → commit `feat(alliance): header facts as pure functions`.

### Task 2: verdict parts and `AllianceHeader`

**Files:** Modify `verdict.ts`, `verdict.test.ts`. Create `AllianceHeader.tsx`, `AllianceHeader.test.tsx`, `alliance.css`.

**Interfaces:**
- `verdict.ts`: `type VerdictPart = { kind: 'text' | 'figure'; text: string }`; `verdictParts(facts): VerdictPart[]` (figures: `#rank`, the lead/gap, `[TAG]` stays text, minimum power, `HQ n`); `composeAllianceVerdict` becomes the parts joined, existing tests unchanged.
- `AllianceHeaderView` props: `{ power, memberCount, observed, membersFrom, rosterCapturedAt, rosterComplete, serverId, info: AllianceInfo | null, standing: StandingRow[] | null, readings: PowerReading[] | null, allianceId, now }`. Renders: a `.alliance-leds` row (0–2 `Led`), a `Verdict` (omitted when the parts are empty) with figures in `<code>`, and a `CellGrid columns={6}`: Power (hero; context `+1.2G in 7d`, tone up/down), Rank on server (`#2` unit `/12`; context the gap sentence), Members (`93` unit `/100`; context `84 observed`, note when last-known), `Join (raw)` (raw integer or dash), Minimums (`30M · HQ 20`), Language (name; context country name).
- `AllianceHeader` (container): `{ detail, now }` → three `useQuery` calls (`['alliance-info', id]`, `['alliance-standing', serverId]`, `['alliance-power-readings', id]`) → `AllianceHeaderView`. Errors on the extra queries degrade to dashes; the page's own detail query still gates the page.

- [ ] Tests: `verdictParts` marks the figures; view "renders the six cells with contexts"; "renders without an info card" (dashes, no verdict minimums); "warns on an old roster and flags a cut-short capture"; "last-known members say so".
- [ ] FAIL → implement → PASS → commit `feat(alliance): console header with LEDs, verdict and cell grid`.

### Task 3: `AllianceIntro`

**Files:** Create `AllianceIntro.tsx`, `AllianceIntro.test.tsx`; add `namedServers(text): number[]` to `allies.ts` (+ test).

**Interfaces:**
- `namedServers(text)` — distinct server ids of every ally segment `parseIntro(text, [])` finds.
- `IntroText({ text, known })` — one `<p class="intro-line">` per line, text as text, ally with an `allianceId` as `<a href={allianceHash(id)}>`, without one as plain text; an empty line keeps its break.
- `AllianceIntro({ allianceId })` — reads `['alliance-info', id]`; renders nothing with no intro and no announce; otherwise a `<section>` with `Intro` and, when `info.announce` is non-null, `Announcement` (members only, decided by the view). Known alliances: `['alliance-tags', servers]` from `alliances` (`alliance_id, server_id, current_code`, `in server_id`), skipped when no server is named.

- [ ] Tests: links a known tag to its alliance page; unknown tag and cross-server tag stay text; line breaks preserved; `namedServers` distinct and ordered.
- [ ] FAIL → implement → PASS → commit `feat(alliance): intro and announcement with allied tags as links`.

### Task 4: `AllianceMoves` and the Moves tab

**Files:** Create `AllianceMoves.tsx`, `AllianceMoves.test.tsx`. Modify `lib/route.ts` (add `'moves'` after `'overview'`, label `Moves`), `lib/shellNav.tabs.test.ts`, `AllianceOverview.tsx`, `AlliancePage.tsx`.

**Interfaces:**
- `MOVES_PAGE_SIZE = 20` (builder's choice; `lib/pagination` default).
- `MovesTable({ rows, now })` — `.table-wrap` table: Player (link via `playerHash`), Move (`Led`: in → ok `IN`, out → bad `OUT`, relocated → neutral `RELOCATED`), From / to (`otherAllianceLabel`, linked via `allianceHash` when `other_alliance_id`), Power at the time (compact), Observed (`formatAge`, title the ISO time).
- `movesEmptyText(ownAlliance: boolean): string` — own: `Nothing to show. For one of our alliances this feed is for its members, officers and admins.`; other: `No moves observed in the last 90 days.`
- `RecentMoves({ allianceId, ownAlliance, now })` — newest five + a link to the Moves tab.
- `MovesTab({ allianceId, ownAlliance, now })` — `.filter-chip` buttons All / In / Out (+ Relocated only when a row has it), `Pager`, `MOVES_CAVEAT` under the table. Query `['alliance-moves', id]`, 90-day window.
- `AllianceDetail` gains `ownAlliance: boolean` (raw `alliances.is_own`), used only for the empty-state wording.
- Overview order: intro, recent moves, strongest members, then the existing officer departures panel unchanged (0067).

- [ ] Tests: table renders direction LEDs and labels; "own alliance empty state"; filter narrows and resets the page; pager appears past 20 rows; route test accepts `#/alliance/<id>/moves`; sidebar tab list includes Moves.
- [ ] FAIL → implement → PASS → commit `feat(alliance): recent moves on Overview and a Moves tab`.

### Task 5: Look at it

- [ ] Add dev fixtures for the new query keys (`alliance-info`, `alliance-standing`, `alliance-power-readings`, `alliance-moves`, `alliance-tags`) and the missing detail fields.
- [ ] `preview_start dashboard-local`, open `/index.dev.html#/alliance/<ours>/overview` and `/moves`: light, dark, 320px. Check no horizontal page scroll, shared borders, mono labels, no pills. Screenshot.
- [ ] Gates: `pnpm check && pnpm typecheck && pnpm test && pnpm build`.
- [ ] Push `alliance-page-ui`; draft PR base `alliance-page-moves-57cdca`, stating what was not checked signed in against real data.
