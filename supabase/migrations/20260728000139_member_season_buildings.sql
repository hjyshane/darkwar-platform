-- 0139: each member's season buildings, at the level last seen.
--
-- The board this exists for is a grid: members down the side, buildings
-- across the top, a level in the cell. Building it in the client would mean
-- pulling every snapshot row and reducing them in the browser, and the
-- snapshot table grows by observation — one pan over a member's plot writes
-- a row per building, and the collector pans continuously. 0102 moved the
-- roster's join into a view for the same reason and recorded why: the round
-- trip is the cost, and the database is an ocean away from the reader.
--
-- `distinct on` gives the newest row per (member, building type). A member
-- holds one building of each type in everything observed so far, but the key
-- is (player_id, building_type_id) rather than object_id because the BOARD
-- asks "what level is their greenhouse", and a rebuilt building is still
-- their greenhouse. `season_building_snapshots.object_id` remains the right
-- key for one building's own history; this view is the other question.
--
-- security_invoker, like member_roster and alliance_latest: the underlying
-- table is already member-gated by its own policy (0138), so the view needs
-- no gate of its own and a viewer gets nothing without one being written.

create index if not exists season_building_member_type_idx
  on public.season_building_snapshots (player_id, building_type_id, captured_at desc)
  where player_id is not null;

create view public.member_season_buildings
with (security_invoker = true) as
select distinct on (b.player_id, b.building_type_id)
  b.player_id,
  p.current_name,
  b.game_uid,
  b.server_id,
  b.building_type_id,
  b.level,
  b.object_id,
  b.x,
  b.y,
  b.captured_at
from public.season_building_snapshots b
join public.players p on p.player_id = b.player_id
join public.alliances a
  on a.alliance_id = p.current_alliance_id
 and a.is_own
where b.player_id is not null
order by b.player_id, b.building_type_id, b.captured_at desc;

grant select on public.member_season_buildings to authenticated;

comment on view public.member_season_buildings is
  'One row per own-alliance member per season building type, at the level '
  'last observed. Newest-per-pair rather than newest overall: a pan sees '
  'some of a member''s plot and not the rest, so a single captured_at would '
  'blank the buildings that pan happened to miss.';
