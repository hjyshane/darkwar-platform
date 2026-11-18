# Black Gold battle map: planning where each player's base goes — design (DRAFT)

2026-11-18. From the website feedback triage (`docs/website-feedback-2026-11.md`, item G):
an R4/R5 wants "a map for BGB with the ability to place player bases on it so you can plan
everything in advance". Black Gold (wire name `dragon`, on screen "Black Money") is the
alliance's two-team battle: teams A and B, 20 starters and up to 20 substitutes each.

**Status: blocked on one fact this repository does not hold — see §3.** Everything else below is
designed so the answer changes data, not structure.

## 1. What exists

| Piece | Where | Note |
|---|---|---|
| Who is on which team, starter or sub | `black_money_signup_snapshots` (0178): `team_index` 1/2, `state` 1 starter / 2 sub | Read from the game (`dragon.assign.player.info`); the game owns the lineup, the site mirrors it |
| Battle results, per-player scores, opponents, misses | 0178, 0182, 0183; `features/blackMoney/*` | Read-only history |
| A drawn plan on a map, members assigned to tiles, saved whole, stale-save refusal, recoverable delete | `hive_formations` + `hive_formation_slots` (0165–0173, 0330), `features/hive/*` (`FormationEditor`, `TileGrid`) | **Bound to the world**: `server_id` FK, anchors and offsets checked against the 998×998 world map (`hive_formation_fits_the_map`) |

So "BGB lineup" in the feedback is already the Black Gold tab (a mirror of the in-game roster).
What is new is a **drawn plan on the battlefield**, which has no home yet.

## 2. Goal and non-goals

Goal: an officer opens a Black Gold plan for team A or B, sees the battlefield, places the
team's players on it, saves, and every member of the alliance can read their own spot —
the hive page's shape, for this event.

Non-goals: no writes to the game (ADR-0002/0003 allowlist unchanged — this only plans);
no scoring, no automatic placement, no new capture.

## 3. The open fact: what is the battlefield?

I could not find, in the repo or fixtures, any description of the Black Gold battlefield:
its size, whether it is a tile grid with coordinates, whether players pick a spot or the game
assigns it, and what fixed features (objectives, spawns, lanes) sit on it. `dragon.*` payloads
carry rosters and results only. **Owner: please provide** a screenshot of the battlefield
(and, if there is one, the in-game rule for how a player's position is chosen).

What each answer means:

| If the battlefield is… | Then the map is… |
|---|---|
| A tile grid with coordinates | The hive grid at a fixed size with its own bounds (option A) |
| A picture with named zones/slots | An image plus a list of slot positions (option B) |
| Not placeable at all (game decides) | Nothing to build; drop item G and say so |

## 4. Options

**A. Own tables, shared editor component.** New `bgb_plans` (alliance, team 1/2, name, optional
map key, note, same audit/lock/soft-delete columns as 0330) and `bgb_plan_slots` (plan, dx/dy or
zone id, optional `player_id`, label). The map's size and fixed features live in a small static
definition in `apps/dashboard` keyed by map key, not in the database. The editor is extracted
from `FormationEditor` so the grid, drag, and "saved whole" behaviour are shared rather than
copied. Costs a migration and a refactor; keeps hive rules intact.

**B. Same, with an image background.** As A, plus the picture. Supabase Storage is deliberately
deferred (CLAUDE.md), so the image ships as a dashboard asset, not an upload.

**C. Reuse `hive_formations` with a pseudo-server.** Rejected: the server FK, the 998 bounds, and
the "fits the map" trigger all say "world". Bending them risks the hive plan members rely on
on move day.

**Recommendation: A, or B if §3 says picture.** Build only after §3 is answered.

## 5. Design (A/B)

- **Scope:** a plan belongs to an alliance and a team (A/B). Members read it; users with a new
  `bgb.plan` capability (or reuse `hive.plan` — owner call) write it.
- **People:** the assign list is the team's starters then substitutes from the latest signup
  snapshot (rows sharing the newest `captured_at`, per CLAUDE.md). A player who left the
  alliance shows empty, as in the hive (`alliance_roster_latest`, never `current_alliance_id`).
- **One row per person:** the board read folds slots into one row per placed player
  (`distinct on`/`jsonb_agg`), because PostgREST caps at 1,000 rows.
- **Safety:** copy the hive's refuse-stale-save, delete-is-recoverable, last-editor stamp, rather
  than invent less.
- **Surface:** a "Plan" view inside Black Gold, per team; link from the Alarms board is optional later.
- **Member view:** "your spot on team A" first, as `MyTile` does for the hive.

## 6. Tests

- pgTAP: member can read, non-officer write fails, a plan in another alliance is invisible
  (negative tests, §20.2); slot outside the map refused; one player twice in a plan refused.
  Fixture uses one `captured_at` per signup batch.
- Vitest: extracted editor keeps the hive's existing tests green; BGB board fold gives one row
  per person; roster-departure shows empty.
- Migration number taken from `origin/main` at push time (`new-migration` skill).

## 7. Phases

1. Answer §3 (owner). 2. Extract the shared grid/editor part with no behaviour change (own PR).
3. Migration + pgTAP. 4. BGB plan view, officer edit, member read. 5. Link from Black Gold tab.

## 8. Open questions

1. Battlefield screenshot and placement rule (§3).
2. Separate `bgb.plan` capability, or reuse `hive.plan`?
3. One live plan per team, or several drafts like the hive?
4. Should substitutes get spots, or only the 20 starters?
