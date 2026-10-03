-- The calendar's two categories (0210) become six, the way members talk about
-- the calendar rather than the way the game stores it:
--
--   major      the big fights: Capital Clash, Black Gold, Bio-Mutant
--   recurring  every day or every week: Alliance Duel, Tyrant, Survival
--              Preparedness
--   season     the season's own events and its finale — Ice Pit, Endless
--              Night, Season Pass, Celebration Shop, Survivor Market
--   pass       battle passes, weekly and monthly passes, Industrial Surge
--   premium    things to buy: packs, shops, markets, gacha draws
--   event      everything else that is played
--
-- 'shop' is gone: what it held is now 'pass' or 'premium'. The tool's own
-- rows are rewritten by the next `dw-collector game-names` run
-- (gamedata/names.py); a row a person classified as 'shop' becomes 'premium'
-- here, the nearer of the two, and stays theirs to change.

alter table public.event_names drop constraint event_names_category_check;

update public.event_names set category = 'premium' where category = 'shop';

alter table public.event_names
  add constraint event_names_category_check check (
    category is null
    or category in ('major', 'recurring', 'season', 'event', 'pass', 'premium')
  );
