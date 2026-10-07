# Starting a new season

Seasons and their buildings are data (0242), edited in **Settings -> Catalogue -> Seasons**
(`catalogue.write`, shared by every alliance). No code change or deploy.

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

Not covered here: the season rank rule (`season_lab` in Settings -> Rank tiers) still names one
building and a window by hand. Pick the new building there after naming it.

If the seasons table is empty or unreadable, the dashboard falls back to the Season 2 and Season 3
lists compiled into `features/season/buildings.ts`.
