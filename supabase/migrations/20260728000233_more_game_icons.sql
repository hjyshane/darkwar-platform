-- 0233: icons for every item, resources, and the game's rank glyphs.
--
-- 0232's first batch covered the items an upgrade costs; packs and the Ruby
-- shop list far more (888 items have art in the asset pack). The dashboard
-- asks for item icons by id, so the larger table costs a reader nothing it
-- does not show. Two new kinds:
--   resource  aps_resources.icon: Wood, Iron, Electricity, Food, Coin, ...
--   ui        the star and awakening glyphs, by the dashboard's own names
--             (star_full, star_empty, pentagon_full, pentagon_empty)
-- Still members only (0232's policies are unchanged).

alter table public.game_icon_refs drop constraint game_icon_refs_kind_check;
alter table public.game_icon_refs
  add constraint game_icon_refs_kind_check
  check (kind in ('hero', 'exclusive', 'gear', 'item', 'resource', 'ui'));
