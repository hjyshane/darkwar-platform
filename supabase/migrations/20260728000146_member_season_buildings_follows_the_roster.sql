-- 0146: the season building board follows the ROSTER, not players.current_alliance_id.
--
-- The board showed 67 of 84 members and said nothing about the other 17.
--
-- 0139 decided who is a member by walking `players.current_alliance_id` to an
-- alliance marked `is_own`. That column does not track the roster: measured
-- against production, it names 94 players for an alliance whose roster holds
-- 84 — ten who have left and not been forgotten. It is a cached
-- denormalisation updated on its own schedule, and every screen that trusts
-- it inherits whatever drift has accumulated.
--
-- `alliance_roster_latest` IS the roster: the newest observed membership
-- snapshot, which is where the number 84 on somebody's screen comes from.
-- `member_roster` (0102) already joins through it for exactly this reason.
-- 0139 was the odd one out, and being the odd one out is the whole bug —
-- two views answering "who is in the alliance" with different numbers.
--
-- Measured before and after on production: 82 roster members have a building
-- observed, against the 72 the old join produced.
--
-- WHAT THIS DOES NOT FIX is why current_alliance_id drifts. That column is
-- read by other things and deserves its own look; this migration stops one
-- board depending on it, and deliberately does not paper over the rest.

drop view if exists public.member_season_buildings;

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
-- The roster, not the cached pointer. `alliance_roster_latest` is already
-- scoped to one snapshot per player, so this adds no fan-out.
join public.alliance_roster_latest r on r.player_id = b.player_id
join public.alliances a on a.alliance_id = r.alliance_id and a.is_own
join public.players p on p.player_id = b.player_id
where b.player_id is not null
order by b.player_id, b.building_type_id, b.captured_at desc;

comment on view public.member_season_buildings is
  'Season buildings for the CURRENT roster, newest level per member per type. Membership comes from alliance_roster_latest, never from players.current_alliance_id.';

grant select on public.member_season_buildings to authenticated;
