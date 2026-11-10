# Player Profile Header — Phase A (data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every fact the player profile header (spec §1–§5) needs, as queries and pure functions with fixture tests, without touching the header UI.

**Architecture:** One new RPC (`player_server_rank`) gives rank and both neighbours in one row; everything else is a PostgREST query over existing tables plus a pure TypeScript function that turns rows into facts. Pure functions live in `apps/dashboard/src/features/player/` one file per fact and are tested with hand-written fixtures; the only wiring into `PlayerPage.tsx` is the server-rank tile switching to the RPC.

**Tech Stack:** Supabase (PostgREST + plpgsql/sql function), pgTAP, React Query, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-08-player-profile-design.md`

## Global Constraints

- No RLS change; no new table; no new capture. The one migration adds a `security invoker` function over `public.players`, which is already `public_read`.
- Migration version is taken from `origin/main` at push time (today: `0308` is highest, so the new file is `20260728000312_*`); run `scripts/check-migration-order.sh` before pushing. pgTAP test numbered to match (`312_*_test.sql`).
- Never pin `scoring_version`; one `captured_at` per roster batch in fixtures.
- English UI only. Board nouns in the verdict are: heroes, pets, buildings, tech, troops, vehicle.
- Retention windows (0070/0299): own-alliance members 3 months → header window **30d**; everyone else **7d**. Always written out.
- Share omitted when the six boards do not sum to the player's total within **2%**. `army_power` (Troops) is excluded from the share denominator.
- Shield clause only when the newest world read is within **7 days**.
- Diffs stay in `features/player/`, `supabase/migrations`, `supabase/tests`, `packages/shared-types`, and the one tile line in `PlayerPage.tsx`.
- Commit messages: Conventional Commits with the `Co-Authored-By` trailer from the session reminder.

## Review Focus

1. A player whose `power` is null on `players` → RPC returns no row; TS returns null; verdict drops the rank clause (Task 1, Task 3).
2. A board row with `power` present but `rank` null newer than a ranked row (profile read after the board) → value from the new row, rank from the older ranked row (Task 4).
3. Only one history row inside the window → `as of {date}`, not a delta of 0 (Task 5).
4. `alliance_member_snapshots` filtered to empty by RLS (no 42501, just no rows) → falls back to HQ level; a 42501 does the same (Task 6).
5. A player on two arena leagues plus a null-league board → at most three rows, sorted by league, newest per league (Task 7).

---

### Task 1: `player_server_rank` RPC + pgTAP

**Files:**
- Create: `supabase/migrations/20260728000312_player_server_rank.sql`
- Create: `supabase/tests/312_player_server_rank_test.sql`
- Modify: `packages/shared-types/src/database.types.ts` (public `Functions`, alphabetical, near `player_ranking_page`)

**Interfaces:**
- Produces: `public.player_server_rank(p_player_id uuid) returns table (rank integer, total integer, power bigint, next_above_power bigint, next_below_power bigint)`. Zero rows when the player is unknown or has null power. `rank` = players on the same server with strictly more power, plus one (ties share the better place, as today). `total` = players on the server with non-null power. `next_above_power` = smallest power strictly greater than the player's (null at rank 1); `next_below_power` = largest power strictly less (null at the bottom).
- TS type entry: `player_server_rank: { Args: { p_player_id: string }; Returns: { rank: number; total: number; power: number; next_above_power: number | null; next_below_power: number | null }[] }`.

- [ ] **Step 1: Write the failing pgTAP test**

`312_player_server_rank_test.sql`: `select plan(9)`. Insert server `5990` (`server_group 'test'`), five players on it with game_uids 59900001..59900005 and powers 500, 400, 400, 100, null. Also one auth user + `app_users` row with role `viewer` (uuid `...f309`), helper `pg_temp.act_as(uuid)` as in `256_gift_extra_players_test.sql`.
  1. `results_eq` for the 500 player: `(1, 4, 500, null, 400)`.
  2. `results_eq` for one 400 player: `(2, 4, 400, 500, 100)` — the tie shares #2 and the neighbour below is 100, not the other 400.
  3. `results_eq` for the 100 player: `(4, 4, 100, 400, null)`.
  4. `is_empty` for the null-power player.
  5. `is_empty` for a random uuid.
  6. `ok(not (select prosecdef from pg_proc where proname = 'player_server_rank'))` — invoker, so it can never read more than `players` allows.
  7. `set local role anon;` then `results_eq` for the 500 player is the same row (players is public-read; the tile already works logged out).
  8. `set local role authenticated; select pg_temp.act_as(viewer)` → same row.
  9. `ok(not has_function_privilege('public', ...))` — not executable by PUBLIC (the hosted default grants trap).
  `reset role; select * from finish(); rollback;`

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm db:test:local 312`
Expected: fails with `function public.player_server_rank(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Header comment: why one row (the verdict needs the gap to #rank-1 and the lead over #rank+1, and the tile used two head-count requests). `language sql stable set search_path = ''`, invoker. Body: one CTE `me` selecting `server_id, power` from `public.players` where `player_id = p_player_id and power is not null`; then one select with four scalar subqueries over `public.players p` joined on `p.server_id = me.server_id and p.power is not null` (`count(*) filter (where p.power > me.power) + 1`, `count(*)`, `min(p.power) filter (where p.power > me.power)`, `max(p.power) filter (where p.power < me.power)`), all served by `players_server_power_idx (server_id, power desc nulls last)`. `revoke all on function ... from public; grant execute ... to anon, authenticated, service_role;` plus `comment on function`.

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm db:test:local 312`
Expected: `312_player_server_rank_test.sql .. ok`.

- [ ] **Step 5: Add the function to `database.types.ts`**

Insert the `player_server_rank` block after `player_ranking_servers` (alphabetical). Run `pnpm typecheck` — passes.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260728000312_player_server_rank.sql supabase/tests/312_player_server_rank_test.sql packages/shared-types/src/database.types.ts
git commit -m "feat(db): player_server_rank returns rank and both neighbours in one row"
```

---

### Task 2: `serverRank.tsx` on the RPC

**Files:**
- Modify: `apps/dashboard/src/features/player/serverRank.tsx`
- Modify: `apps/dashboard/src/features/player/serverRank.test.ts`
- Modify: `apps/dashboard/src/features/player/PlayerPage.tsx:434` (tile props)

**Interfaces:**
- Consumes: Task 1's RPC type.
- Produces:
  ```ts
  export interface ServerRankRow { rank: number; total: number; power: number; next_above_power: number | null; next_below_power: number | null }
  export interface ServerRankFacts { rank: number; total: number; gapToAbove: number | null; leadOverBelow: number | null }
  export function serverRankFacts(row: ServerRankRow | null | undefined): ServerRankFacts | null
  export async function fetchServerRank(playerId: string): Promise<ServerRankFacts | null>
  export function useServerRank(playerId: string): UseQueryResult<ServerRankFacts | null>
  export function PlayerServerRankTile({ playerId }: { playerId: string })
  ```
  `gapToAbove = next_above_power - power` (null at rank 1); `leadOverBelow = power - next_below_power` (null at the bottom). `serverRankOf` is removed.

- [ ] **Step 1: Rewrite the test**

```ts
describe('serverRankFacts', () => {
  it('turns neighbour powers into a gap and a lead', () => {
    expect(serverRankFacts({ rank: 2, total: 4, power: 400, next_above_power: 500, next_below_power: 100 }))
      .toEqual({ rank: 2, total: 4, gapToAbove: 100, leadOverBelow: 300 });
  });
  it('has no gap at the top and no lead at the bottom', () => {
    expect(serverRankFacts({ rank: 1, total: 4, power: 500, next_above_power: null, next_below_power: 400 }))
      .toEqual({ rank: 1, total: 4, gapToAbove: null, leadOverBelow: 100 });
    expect(serverRankFacts({ rank: 4, total: 4, power: 100, next_above_power: 400, next_below_power: null }).leadOverBelow).toBeNull();
  });
  it('is null when the RPC returned no row', () => {
    expect(serverRankFacts(null)).toBeNull();
    expect(serverRankFacts(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `pnpm --filter @dw/dashboard test serverRank` → `serverRankFacts is not a function`.

- [ ] **Step 3: Implement** — `fetchServerRank` calls `supabase.rpc('player_server_rank', { p_player_id: playerId })`, throws on error, passes `data?.[0]` to `serverRankFacts`. `useServerRank` wraps it with `queryKey: ['player-server-rank', playerId]`, `staleTime: 10 * 60_000`. Tile keeps its label/note text but takes `playerId`; `'—'` when facts are null. Update the single call site in `PlayerPage.tsx` to `<PlayerServerRankTile playerId={data.playerId} />`.

- [ ] **Step 4: Run** `pnpm --filter @dw/dashboard test serverRank && pnpm typecheck` → pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/player/serverRank.tsx apps/dashboard/src/features/player/serverRank.test.ts apps/dashboard/src/features/player/PlayerPage.tsx
git commit -m "feat(player): server rank tile reads rank and neighbours from one RPC row"
```

---

### Task 3: `composeVerdict`

**Files:**
- Create: `apps/dashboard/src/features/player/verdict.ts`
- Create: `apps/dashboard/src/features/player/verdict.test.ts`

**Interfaces:**
- Consumes: `ServerRankFacts` (Task 2); `compactNumber` from `lib/compactNumber.ts`.
- Produces:
  ```ts
  export const SHIELD_READ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  export interface ShieldFacts { readAt: string; shieldEndAt: string | null }
  export interface RankedBoard { noun: string; rank: number }   // noun: 'heroes' | 'pets' ...
  export interface VerdictFacts {
    serverId: number;
    rank: ServerRankFacts | null;
    shield: ShieldFacts | null;
    boards: readonly RankedBoard[];
    now: Date;
  }
  export type VerdictSegment = { kind: 'text'; text: string } | { kind: 'figure'; text: string };
  export function composeVerdict(facts: VerdictFacts): VerdictSegment[]
  export function verdictText(segments: readonly VerdictSegment[]): string
  ```
  Figures (rank, gap, lead, server id, dates, board ranks) are `figure` segments so phase B can hand them to `Verdict`'s code style; `verdictText` joins them for tests. Power figures use `compactNumber(1)`. Dates are `YYYY-MM-DD` UTC; shield-up time is `YYYY-MM-DD HH:mm UTC`.

- [ ] **Step 1: Write the fixture tests** (`now = new Date('2026-11-08T12:00:00Z')`)

| case | facts | `verdictText` |
|---|---|---|
| rank 1 | rank `{rank:1,total:900,gapToAbove:null,leadOverBelow:59_400_000}` | `Strongest on 580 by 59.4M.` |
| rank 1, alone | leadOverBelow null | `Strongest on 580.` |
| mid rank | `{rank:12,gapToAbove:1_200_000,leadOverBelow:3e6}` | `#12 on 580, 1.2M behind #11.` |
| no rank | rank null, no shield, no boards | `` (empty array) |
| shield up | shield `{readAt:'2026-11-08T10:00:00Z', shieldEndAt:'2026-11-08T20:30:00Z'}` | `... Shield up until 2026-11-08 20:30 UTC.` |
| shield down | `{readAt:'2026-11-06T..', shieldEndAt:'2026-11-05T..'}` | `... Shield off since 2026-11-05.` |
| never shielded | `shieldEndAt: null`, readAt within 7d | `... Shield off.` |
| no shield read | `readAt: '2026-10-30T..'` (9 days) | no shield clause |
| boards | `[{noun:'tech',rank:1},{noun:'vehicle',rank:1},{noun:'pets',rank:1},{noun:'heroes',rank:2}]` | `... Tech, vehicle, pets #1; heroes #2.` |
| no #1 | `[{heroes,2},{pets,5}]` | `... Pets #5.` |
| all #1 | `[{heroes,1},{pets,1}]` | `... Heroes, pets #1.` |
| no composition | `boards: []` | no board clause |
| segments | mid rank case | `segments[1]` is `{kind:'figure', text:'#12'}` |

Clauses joined by a single space; first letter of each clause capitalised.

- [ ] **Step 2: Run** `pnpm --filter @dw/dashboard test verdict` → fails, module missing.

- [ ] **Step 3: Implement** the three clause builders (`rankClause`, `shieldClause`, `boardClause`) each returning `VerdictSegment[] | null`, and `composeVerdict` concatenating the non-null ones in that order. Board clause: `#1` boards in given order joined with `, `; weakest = highest `rank` among boards not already named; separated by `; `.

- [ ] **Step 4: Run** the test → pass. **Step 5: Commit** `feat(player): composeVerdict with rank, shield and board clauses`.

---

### Task 4: Composition boards

**Files:**
- Create: `apps/dashboard/src/features/player/composition.ts`
- Create: `apps/dashboard/src/features/player/composition.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BOARD_METRICS = ['hero_power_total','pet_power_total','building_power','science_power','army_power','mod_car_power'] as const;
  export type BoardMetric = typeof BOARD_METRICS[number];
  export const RANKED_METRICS: ReadonlySet<string> = new Set(['hero_power_total','pet_power_total']);
  export const BOARD_NOUN: Record<BoardMetric, string> = { hero_power_total:'heroes', pet_power_total:'pets', building_power:'buildings', science_power:'tech', army_power:'troops', mod_car_power:'vehicle' };
  export const SHARE_TOLERANCE = 0.02;
  export interface BoardRow { metric: string; power: number | null; rank: number | null; captured_at: string }
  export interface Board { metric: BoardMetric; noun: string; value: number; capturedAt: string; rank: number | null; share: number | null }
  export function composeBoards(rows: readonly BoardRow[], totalPower: number | null): Board[]
  export function sharesAddUp(boards: readonly Board[], totalPower: number | null): boolean
  export async function fetchBoardRows(playerId: string): Promise<BoardRow[]>
  export function rankedBoards(boards: readonly Board[]): RankedBoard[]   // for Task 3
  ```
  Rules: rows not in `BOARD_METRICS` are ignored; value/capturedAt from the newest row with non-null `power`; rank from the newest row with non-null `rank`, and only for `RANKED_METRICS`; boards with no value are omitted; sorted by value desc. `sharesAddUp` = total not null and `|sum(all six present) − total| ≤ 2% of total`. When it holds, `share = value / sum(non-troop boards)` for non-troop boards and null for Troops; otherwise all shares null. `fetchBoardRows` selects `metric, power, rank, captured_at` from `player_component_power_snapshots` for the player, `.in('metric', BOARD_METRICS)`, newest first, `.limit(600)` (one player; newest-first so a truncation loses only old rows).

- [ ] **Step 1: Tests**
  - `value comes from the newest row of either source, rank from the newest ranked row`: hero rows `[{power:70_857_050, rank:null, captured_at:'2026-11-08'}, {power:70_000_000, rank:3, captured_at:'2026-11-01'}]` → `value 70_857_050, rank 3`.
  - `profile metrics never carry a rank`: building row with `rank: 7` → `rank: null`.
  - `boards with no row are omitted`: only hero + pet rows → length 2.
  - `troops are excluded from the share denominator`: six boards 10,20,30,40,50 (troops),60 total 210 → troops share null; buildings share `60/160`.
  - `share omitted when the sum check fails`: same six with total 300 → every share null; `sharesAddUp` false.
  - `partial boards never show shares`: hero+pet only with total 344_948_617 → shares null.
  - `sorted by value desc`.
  - `rankedBoards keeps only ranked boards with a rank`: → `[{noun:'heroes',rank:3}]`.

- [ ] **Step 2** fail → **Step 3** implement → **Step 4** pass → **Step 5** commit `feat(player): composition boards with sum-checked shares`.

---

### Task 5: Retention-aware delta window

**Files:**
- Create: `apps/dashboard/src/features/player/deltaWindow.ts`
- Create: `apps/dashboard/src/features/player/deltaWindow.test.ts`

**Interfaces:**
```ts
export type WindowDays = 7 | 30;
export function retentionWindowDays(isOwnAlliance: boolean): WindowDays   // true→30, false→7
export interface HistoryRow { captured_at: string; power: number | null; kills: number | null; source_command: string }
export type Delta = { kind: 'delta'; change: number; windowDays: WindowDays; from: string; to: string } | { kind: 'asOf'; at: string; value: number } | null;
export function deltaOver(rows: readonly HistoryRow[], pick: (row: HistoryRow) => number | null, windowDays: WindowDays): Delta
export function powerDelta(rows, windowDays): Delta      // pick = row.power
export function killsDelta(rows, windowDays): Delta      // pick = row.source_command === 'kill.rank' ? row.kills : null
export async function fetchHistoryWindow(playerId: string, windowDays: WindowDays, now: Date): Promise<HistoryRow[]>
```
`deltaOver`: rows with a non-null pick, sorted by `captured_at`; none → null; one → `asOf`; else `change = newest − oldest`. `fetchHistoryWindow` selects `captured_at, power, kills, source_command` from `player_power_history` where `player_id`, `captured_at >= now − windowDays`, ascending.

- [ ] **Step 1: Tests**: `retentionWindowDays(true) === 30`, `(false) === 7`; power delta over three rows `+59_400_000` with from/to; kills ignore `server.rank` rows (kills null there) and read only `kill.rank` rows; single row → `asOf`; no rows → null; a `kill.rank` row with `power: null` does not break the power series.
- [ ] Steps 2–5; commit `feat(player): kills and power deltas over the retention window`.

---

### Task 6: Tenure, degrading to HQ level

**Files:**
- Create: `apps/dashboard/src/features/player/tenure.ts`
- Create: `apps/dashboard/src/features/player/tenure.test.ts`

**Interfaces:**
```ts
export type TenureCell = { kind: 'tenure'; days: number; since: string } | { kind: 'hq'; level: number } | null;
export function tenureCell(firstSeenAt: string | null, hqLevel: number | null, now: Date): TenureCell
export async function fetchFirstSeenInAlliance(playerId: string, allianceId: string): Promise<string | null>
```
`fetchFirstSeenInAlliance`: `alliance_member_snapshots` select `captured_at` where `player_id`, `alliance_id`, ascending, `limit(1).maybeSingle()`; `42501` → null; no row → null (RLS filters rows for a non-officer rather than erroring, so empty and refused look the same and both degrade). `tenureCell`: firstSeenAt → `{tenure, days: floor((now − first)/day), since}`; else hqLevel → `{hq}`; else null. Doc comment: retention keeps our rows 3 months (0070/0299), so tenure is bounded by that; phase B labels it "in alliance ≥ N d" if it hits the bound — decided in phase B.

- [ ] **Step 1: Tests**: 45 days → `{kind:'tenure', days:45, since}`; null first seen + hq 30 → `{kind:'hq', level:30}`; both null → null; same instant → days 0.
- [ ] Steps 2–5; commit `feat(player): alliance tenure cell degrading to HQ level`.

---

### Task 7: Arena summary selector

**Files:**
- Create: `apps/dashboard/src/features/player/arenaSummary.ts`
- Create: `apps/dashboard/src/features/player/arenaSummary.test.ts`

**Interfaces:**
```ts
export const ARENA_SUMMARY_ROWS = 3;
export function arenaSummary(entries: readonly PlayerArenaEntry[]): PlayerArenaEntry[]
```
Input is already newest-per-league from `newestPerLeague` (`playerArena.ts`), lineups attached by `fetchPlayerArena` via `features/arena/lineups.ts`. Output: sorted with `compareLeagues`, first three, empty in → empty out.

- [ ] **Step 1: Tests**: four leagues → three rows in league order; empty → `[]`; input order shuffled → sorted.
- [ ] Steps 2–5; commit `feat(player): arena summary selector (newest per league, three rows)`.

---

### Task 8: Gate, push, draft PR

- [ ] `pnpm check && pnpm typecheck && pnpm test` and `pnpm db:test:local` (full) — all green.
- [ ] `git fetch origin main && bash scripts/check-migration-order.sh` — renumber if the number is taken (it was: 0309 became 0312).
- [ ] `git push -u origin player-profile-header-d56681`; `gh pr create --draft --title "feat(player): profile header data (phase A)"` with a body listing, per spec section, what phase B consumes: `useServerRank`/`ServerRankFacts`; `composeVerdict` + `VerdictSegment`; `composeBoards`/`fetchBoardRows`/`BOARD_NOUN`; `retentionWindowDays`, `powerDelta`, `killsDelta`, `fetchHistoryWindow`; `tenureCell`/`fetchFirstSeenInAlliance`; `arenaSummary`. Note: no `player_board_rank_latest` view (no second player-wide use found); RPC applied to prod only by `db push` on merge.
