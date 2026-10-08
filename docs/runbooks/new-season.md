# Starting a new season

Seasons and their buildings are data (0242), edited in **Settings -> Catalogue -> Seasons**
(`catalogue.write`, shared by every alliance). No code change or deploy.

**The season itself is detected (0245).** Every login carries the game's season calendar
(`seasonStage`, `nextSeasonStage`, `seasonInfo`); the collector stores it in
`game_season_snapshots` and a trigger creates or fills the `seasons` row: "Season N" with its
start, and the previous season's end (the game's settle time). The game's stage is one below our
number (stage 2 is Season 3). The game announces the next stage some six weeks ahead, so the new
row usually exists well before the start day. It only fills what is empty: a name or date set in
Settings is never overwritten, and if the game moves a date, edit it there by hand. Step 1 below
is therefore only for a season the game has not announced yet, or to rename one.
Needs the collector running version 1.0.0 of `game_season.py` or later (restart after `git pull`).

1. **Add the season.** Number (next one is suggested), name, and the first game day's start in
   UTC (02:00 on the reset day). The current season is the latest one whose start has passed, so a
   season added with a future start changes nothing until that day.
2. **Sweep the map as usual.** The game sends building *ids* (857000 ...), never names. Each sweep
   fills `player_season_buildings_current`; nothing needs configuring for a new id to be collected.
3. **Name what turned up.** Under "Seen, not named", every building type some player has a level
   for that no season has named. Type a name and press Name; it is added to the season picked above.
   An id you already know can be added by hand ("Add by id"). Tick "Guess" for a name you are not
   sure of: it is shown with a `*`.
4. **Order.** Buildings show in the order of their "Order" number (10, 20, ...). Change a number to
   move one.

What changes on the start day, without anything else being done:

- The Season tab shows the new season's name and its buildings; the admin-only look-back tab shows
  the season before it.
- The participation page's Season, Round and Week ranges count from the new start.
- **Duel rounds restart.** `internal.duel_round_anchor()` returns the current season's start, so the
  hourly `derive_missing_duel_weeks` job counts four-week rounds from it. Rounds already derived are
  kept. If the new season starts in the middle of an old round (not a multiple of 28 days after the
  last anchor), the weeks that overlap are re-derived under the new boundaries and the derived rows
  for them are replaced. That is the game's own rule, but it is the one place figures already on
  screen can change; check the duel board the day after.

The season rank rule (`season_lab`, Settings -> Rank tiers) is separate: it may open later than the
season does, so it keeps its own dates and its own building. After naming the new season's
buildings, pick the building there; the button "Use <season>'s dates" copies the season's start and
end in, and both stay editable. It is never switched on for you.

If the seasons table is empty or unreadable, the dashboard falls back to the Season 2 and Season 3
lists compiled into `features/season/buildings.ts`.
