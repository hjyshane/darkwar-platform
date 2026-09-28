# Server migration board

Goal: show how the upcoming server migration (577-588, ~late October 2026)
reshapes the group, measured over the people we actually capture.

Owner decisions (2026-09-27):

- No server population totals. "Tracked" people only: the cross-server power
  board (`server.rank`, top 150) plus the rosters of alliances we opened.
- Top board is 150, not 200.
- Four migration tiers with per-server intake quotas are announced later,
  server by server. Not modelled in phase 1.
- Alliances: only the ones we observe (rosters we opened, plus the
  cross-server alliance board, which is observed anyway).

## What the data says (checked 2026-09-27)

- `game_uid` survives a move (ADR 0001). A move is `server_id` changing
  between a pre-migration and a post-migration observation of the same UID.
- Journal check: every `server.rank` entry carries `serverId` (150/150);
  `al.rank` carries `serverId` and `curServerId`; `alliance.rank` carries
  `serverId` and a group-global alliance `uid`. So far serverId == UID
  suffix for every row — nobody has moved yet.
- **Unverified until the first post-migration capture:** that `serverId`
  reports the NEW server rather than the home server. If it reports the
  home server, every mover looks like a stayer. First capture after the
  window opens: compare `serverId`, `curServerId` and the UID suffix for a
  known mover before trusting the board.
- `alliances` is keyed `(server_id, external_id)`; an alliance that moves
  gets a new row. The board groups by `external_id`, never `alliance_id`.
- `retention_report(p_confirm=true)` would delete other servers'
  pre-migration snapshots after 7 days. Do not run it until the event is
  settled. The board is computed from snapshots, not frozen, so this matters.

## Model

`migration_events` (hand-entered, admin writes, members read):
`event_id, name, baseline_at, settled_at (null while the window is open)`.

- BEFORE state of a person = newest observation at or before `baseline_at`,
  no older than 14 days.
- AFTER state = newest observation after `coalesce(settled_at, baseline_at)`.
  While `settled_at` is null the board is live.
- Observation = a `player_snapshots` row (server.rank, kill.rank, profile
  opens) or an `alliance_member_snapshots` row (roster opens).
- Tracked set = people on the newest top-150 batch before / after, plus the
  newest roster of each observed alliance before / after.
- Status: `moved` (both states, server differs), `stayed`, `unseen_after`
  (before only), `appeared` (after only).

## Database (one migration + one pgTAP file)

Functions, `security invoker`, `stable`, so snapshot RLS (member-only) holds:

| function | rows | feeds |
|---|---|---|
| `migration_people(event)` | one per person | building block; filtered lists |
| `migration_servers(event)` | one per server | before/after tracked, in, out, power in/out, top-150 count before/after |
| `migration_flows(event)` | one per (from, to) with from <> to | flow matrix |
| `migration_top_board(event)` | one per person on either top-150 batch | top-150 tab |
| `migration_alliances(event)` | one per observed alliance `external_id` | alliance tab: members/power before and after, left, joined, left-by-moving, alliance server before/after, board power/member count before/after |

Every function returns at most a few hundred rows (PostgREST caps at 1,000).
`migration_people` can exceed that with many rosters, so screens never read
it unfiltered.

pgTAP: statuses, per-server counts, flow, alliance split across two
`alliance_id` rows, AFTER falling back to "live" while `settled_at` is null,
14-day staleness bound, and negative tests (viewer reads nothing; member
cannot insert an event).

## Dashboard

New `migration` feature, route `#/migration`, member-gated. Event picker
(newest first) and four tabs:

1. Overview: headline counts, server table, flow matrix.
2. Top 150: movers / stayers / new / unseen, from → to, power and rank change.
3. Alliances: members and power before/after, left, joined, left-by-moving.
4. (phase 2) Quotas.

## Phase 2 (after tiers are announced)

`migration_quotas(event_id, server_id, tier, quota)`, and intake vs quota
per server. Tier per player is unknown today; `migrate_power`
(admin-only metric) may be what tiers are cut on — confirm when announced.

## Operator runbook addition

Baseline sweep in the last day before the window opens: cross-server power
board, cross-server alliance board, every alliance roster we want on the
board. Same sweep after the window closes. Then set `settled_at`.
