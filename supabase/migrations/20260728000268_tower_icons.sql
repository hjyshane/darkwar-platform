-- 0268: HQ tower and truck pictures for the world map.
--
-- The client draws a player's base as a 3D tower that changes with HQ level;
-- `dw-collector game-towers` renders the 11 distinct models to ~190 px WebP and
-- stores them like every other icon (0232): members only. `ref_id` is the HQ
-- level, `icon_key` the tier picture (tower_01 ... tower_32).
--
-- Trucks (`dw-collector game-trucks`) are the client's own 2D map sprites,
-- `truck_lod_<colour><direction>`: five qualities by eight directions, each
-- 45 degrees on from the last, clockwise from north. `ref_id` is
-- `<quality>-<direction>`.

alter table public.game_icon_refs drop constraint game_icon_refs_kind_check;
alter table public.game_icon_refs
  add constraint game_icon_refs_kind_check
  check (kind in ('hero', 'exclusive', 'gear', 'item', 'resource', 'ui', 'pet', 'tower', 'truck'));
