# Black Gold battle plan: who takes which objective — design (DRAFT 2)

2026-11-18. From the website feedback triage (`docs/website-feedback-2026-11.md`, item G):
an R4/R5 wants "a map for BGB … so you can plan everything in advance". Black Gold (wire name
`dragon`, on screen "Black Money" / "Black Gold Battlefield") is the alliance's two-team battle:
teams A and B, 20 starters and up to 20 substitutes each.

Draft 2 replaces draft 1 after the owner supplied the battlefield minimap and the in-game event
rules (screenshots, 2026-11-18). **They change the design**: the battlefield is not a grid where
players place bases, so the hive editor is the wrong thing to copy.

## 1. What the battlefield is (from the owner's screenshots)

Not read from capture; **unverified against the wire**. Source: in-game event text and the minimap.

- A square minimap, two spawn HQs on opposite corners (red and blue) — **which side is ours
  varies per battle** (top or bottom), so the picture must flip.
- Fixed objectives, symmetric about the centre:

| Icon | Objective | Count on minimap | First control (alliance / personal) | Sustained (per min) | Capture buff |
|---|---|---|---|---|---|
| star | Military Base | 2 | 5,000 / 2,500 | +1,000 / +500 | Troop DMG +20% |
| + | Field Hospital | 2 | 5,000 / 2,500 | +1,000 / +500 | Wound healing +50% |
| drop | Oil Refinery | 6 | 2,000 / 1,000 | +400 / +200 | — |
| house (centre) | Rare Earth Factory | 1 | — | produces Rare Earth Alloy at 15 min and 25 min | — |
| shield | Our / their Headquarters | 1 each | alloy delivered: 100,000 / 10,000 | — | — |

- **Oil Tanks are scattered across the whole map** (owner): gathering, 600 alliance / 60 personal
  per min. Not a fixed spot, so not plannable as a slot.
- Military Base and Field Hospital can be contested only after a delay; starters enter at once,
  **substitutes only once the battle has officially begun** (a natural second wave).
- Only starters/substitutes the leader or R4 picked may enter; the game owns that roster
  (`black_money_signup_snapshots`: `team_index`, `state` 1 starter / 2 sub).

There are **no tile coordinates** and no per-player base to place. What an officer can plan in
advance is **which players go to which objective** (and who carries alloy).

## 2. What exists

| Piece | Where | Reusable? |
|---|---|---|
| Roster: team, starter/sub | `black_money_signup_snapshots` (0178), latest reading = rows sharing the newest `captured_at` | Yes — the source of the assign list |
| History, scores, opponents, misses | 0178, 0182, 0183, `features/blackMoney/*` | Read-only context beside the plan |
| Hive formation tables and editor | `hive_formations`/`_slots` (0165–0173, 0330), `features/hive/*` | **Concept only.** Bound to world coordinates and `server_id`; the tile grid is irrelevant here. Copy the *safety behaviour* (refuse stale save, recoverable delete, last-editor stamp), not the grid |

## 3. Goal and non-goals

Goal: an officer picks team A or B, sees the minimap, drags starters and substitutes onto
objectives (and a few free roles such as "carry alloy" or "hold HQ"), saves; every member sees
"your objective this battle" first, as `MyTile` does for the hive.

Non-goals: no writes to the game (ADR-0002/0003 unchanged — this only plans); no auto-placement;
no scoring; no new capture; no tile coordinates.

## 4. Design

**Map:** a hand-drawn inline SVG in the dashboard (not the owner's JPEG — it is a low-resolution
screenshot of the game's art). Objective positions are normalised 0–1 values in a small static
definition (`features/blackMoney/battlefield.ts`), keyed by objective id (`mil-1`, `mil-2`,
`hosp-1`, `hosp-2`, `oil-1`…`oil-6`, `factory`, `hq-ours`, `hq-theirs`). A **"we are at the
bottom / top"** toggle rotates the picture 180°; the stored plan does not depend on it, because
objectives are named by role relative to us (`mil-ours-near`, `mil-theirs-near`…) rather than by
screen corner. *Exact naming of the near/far pairs needs the owner's confirmation (§7 Q1).*

**Data (new migration, `new-migration` skill):**

- `bgb_plans` — alliance, team 1/2, name, note, `is_live`, audit columns and soft delete as in
  0330. One live plan per (alliance, team).
- `bgb_plan_assignments` — plan, `objective_key text` (checked against the static list by a
  `check` on the known keys), `player_id` (nullable), `role text`, `wave` 1/2 (starters / subs),
  `ordinal`. One row per person per plan (unique `(plan_id, player_id)`).
- Board view folds assignments to **one row per placed player** (PostgREST 1,000-row cap).
- Membership from `alliance_roster_latest`, never `players.current_alliance_id`; a player who left
  shows as empty.
- RLS: members of the alliance read; writers need a capability (§7 Q2). pgTAP negative tests:
  non-officer write fails, another alliance's plan invisible, an unknown objective key refused,
  one player twice refused.

**Surface:** a "Plan" view inside Black Gold, per team. Officer view: minimap with objective
markers, a side list of the team's starters then substitutes (from the latest signup reading),
drag or click to assign, save whole with the hive's stale-save refusal. Member view: their own
objective first, then the plan read-only.

**Reference panel:** the objective table above (points, buffs, alloy times 15/25 min) beside the
map, as data in the same static file so it is one place to fix when the game changes.

## 5. Tests

- Vitest: `battlefield.ts` has every key once and symmetric positions; board fold gives one row
  per person; roster departure renders empty; orientation toggle changes only the picture.
- pgTAP as above, one `captured_at` per signup batch in fixtures.
- The migration number is taken from `origin/main` at push time.

## 6. Phases

1. Confirm §7 (owner). 2. Static battlefield definition + SVG + reference panel, read-only, no
database (shippable alone: it already answers "where is everything"). 3. Migration + pgTAP.
4. Officer editor and member view. 5. Link from the Black Gold tab and, optionally, the alarm board.

Phase 2 is deliberately first: it needs no migration and is useful without the plan.

## 7. Open questions for the owner

1. Which objectives are "near us" vs "near them" at each corner — i.e. is the layout mirrored
   point-for-point so that `mil-ours-near` is always the star beside our HQ? (The minimap shows a
   dashed rectangle beside the top-right HQ; what is it?)
2. A new `bgb.plan` capability, or reuse `hive.plan`?
3. One live plan per team, or several drafts like the hive?
4. Should the plan assign substitutes too (second wave), or only the 20 starters?
5. Is "carry alloy" etc. worth being a free-text role, or a fixed short list?
