# Player profile — design

Date: 2026-11-08. Status: draft for builder check.
Depends on: `2026-11-08-console-foundation-design.md` (kit components
`Verdict`, `CellGrid`/`Cell`, `Led`, `Ticks`, `Chip`). Phase A below does
not need it; phase B does.

## Intent

The player page (`features/player/PlayerPage.tsx`) already holds more data
than the competitor's: growth history, per-hero power, arena lineups,
alliance standing, name history. What it lacks is the *reading* at the
top: who is this, how strong relative to their server, where does the
power sit, are they exposed right now. The competitor answers that in the
first screenful with a verdict sentence, a stat strip with a context line
under every number, and a power breakdown with a rank per category. We add
that reading, built from data we already capture, in the console system.

## Goals

- First screenful answers: rank on server and the gap, shield state and
  since when, position, kills trend, when last seen, how long in the
  alliance, and the shape of their power with a rank per board.
- Lineups for any player we have seen in the arena, with troop type and
  count, which the competitor does not show.
- Everything below the new header stays: tabs, trends, heroes and pets,
  arena, alliance standing, past names.

## Non-goals

- K/D. There is no deaths column anywhere; do not invent one.
- Migration score. Not captured.
- Squads seen in battle. The report body is undecoded protobuf (§15 is
  deliberately not built). Out until that pipeline exists.
- Any change to who may read what. Existing RLS gates stay exactly as they
  are; the header shows a fact only when the viewer can already read its
  source.

## Anti-goals

- A header that is five identical tiles with a bar each. That is the
  competitor's layout; ours is one `Ticks` composition.
- Percentages that do not add up. If the boards we have do not sum to the
  player's total within 2%, show value and rank per board and omit shares.
- A verdict that reads as marketing. It states facts with figures, nothing
  else.

## What the page shows (top to bottom)

### 1. Identity row

Name, favourite button, server, alliance tag linking to the alliance, HQ
level. Right side: three `Led`s — shield (bad when down, with days since;
ok when up, with hours left; neutral when no map read in 7 days), online
(from `player_presence`), data freshness (when the newest power snapshot
is older than 48h, warn).

### 2. Verdict

One sentence composed by a pure function `composeVerdict(facts)` in
`features/player/verdict.ts`, tested with fixtures. Rules, in order:

- Rank clause. Rank 1: "Strongest on {server} by {lead}." Else: "#{rank}
  on {server}, {gap} behind #{rank-1}." Needs the neighbour's power; extend
  the query in `serverRank.tsx` to return rank, next-above power and
  next-below power in one round trip (one row).
- Shield clause when the newest world read is within 7 days: "Shield off
  since {date}." or "Shield up until {time}."
- Board clause when composition exists: name the boards where rank is 1
  and the weakest board with its rank: "Tech, vehicle, pets #1; heroes
  #2."
- Nothing else. Clauses that lack data are dropped, not replaced with
  filler.

Inline figures render through `Verdict`'s code style.

### 3. Cells

`CellGrid` with: Power (context: delta over a window), Rank (context: lead
over next or gap to previous), Position (x·y, context: server, link to the
map via `mapHash()`), Kills (context: delta over the same window; source
is `player_snapshots.kills` through `player_power_history` with
`source_command = 'kill.rank'`), Last seen, and a sixth cell that is In
alliance (days since first appearance in `alliance_member_snapshots`)
when the viewer may read that table for this player, else HQ level.

The delta window follows retention (0070, 0299): snapshots for players
outside an own alliance are kept 7 days, ours 3 months. So the context
line is "+59.4M · 30d" for own-alliance members and "+1.2M · 7d" for
everyone else, and the window is always written out. When no older row
exists the context is "as of {date}".

Reading gates are not widened. `alliance_member_snapshots` is
own-or-officer read (0066, 0193), so a regular member sees tenure only on
their own profile; for teammates the cell is HQ level. That is accepted
for this project.

### 4. Composition (`Ticks`)

Source: `player_component_power_snapshots`. Two kinds of row exist and
the ticks treat them differently:

- Ranked boards: `hero_power_total` and `pet_power_total` from
  `rank.get.by.range` (0018) carry the game's own rank. Their tick shows
  value, share, rank and delta to the neighbour. "Of N" is omitted
  because `board_size` is only how many rows were read, not the board.
- Profile metrics: `building_power`, `science_power`, `army_power`,
  `mod_car_power` (and `hero_power_total` again) from
  `get.user.info.multi` (0086, 0109) carry no rank. Their tick shows value
  and share only. No rank is computed among "known players"; that would
  look like a game rank and is not one.

Value is the newest row for the board from either source; rank is the
newest *ranked* row. `army_power` is its own tick labelled Troops and is
excluded from the share denominator (it overlaps the others). Boards with
no row are omitted, not shown as zero. All of this is one query returning
one row per board for one player, so no view is needed; if the builder
finds a second player-wide use, then `player_board_rank_latest` as a view,
one row per player per board.

### 5. Lineups seen in arena

For each league the player has an arena entry in, the newest lineup:
heroes (icon via `game_icon_refs` kind hero when the viewer may read icons,
else name initial), troop type glyph and count, defence power, and when it
was seen. Reuses `features/arena/lineups.ts` and `LineupCell`. Label makes
the source plain: "Seen in arena · {date}". If the player has no arena
rows, the section is absent.

The existing Arena tab stays and keeps every entry with its legend; this
header section is the summary (newest per league, at most three rows)
with an "all arena entries" link to the tab. Two granularities, not a
duplicate.

### 6. Existing tabs

Unchanged in content. Their markup is restyled only by the foundation.

## Data work (phase A, can start before the foundation merges)

- Extend the server-rank query to one row with neighbours.
- Verify or add `player_board_rank_latest`.
- Kills history source.
- `composeVerdict` with fixtures: rank 1, mid rank, no shield read, shield
  up, shield down, no composition, partial boards.
- pgTAP for any new view: a non-member reads it only for what they could
  already read; `set local role` to authenticated and to community.

## UI work (phase B, after the foundation merges)

Replace the current header and stat strip with sections 1 to 5 using the
kit. Mobile: `CellGrid` wraps, `Ticks` stack vertically below 480px, the
verdict stays one paragraph.

## Constraints

- No new capture. Everything above exists in the schema today except
  possibly a rank view.
- Migration number taken from `origin/main` at push time; run
  `scripts/check-migration-order.sh`.
- Language: English UI, as the site is today (user decision 2026-11-08; a
  translation layer is a separate project if ever wanted). Game names
  show whatever the data columns hold.
- Tests: pure functions get fixture tests; the page gets a render test for
  "minimal data" (name only) and "full data".

## Left to the builder

- Whether the identity row's LEDs collapse to icons below 480px.
- Ordering of boards in `Ticks` (by value descending is the default).

## Decided by Claude, user can override

- Arena lineups replace battle squads. The information need ("what does
  this player field") is met with data we hold.
- No category percentage when the sum check fails. Better absent than
  misleading.
