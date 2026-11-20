-- 0338: dispatch_missions_live - a mission that a later look at its tile no
-- longer shows leaves the list.
--
-- WHY. The view (0254, 0334) kept a mission from its last sighting until its
-- finish instant, whatever happened in between. A mission that was collected,
-- plundered out or otherwise taken off the map before then stayed listed, with
-- a coordinate that had nothing on it: the operator went to several on
-- 2026-11-19 and found empty ground, while the list kept "updating" - new
-- missions arriving, old ones never leaving.
--
-- WHY THE MISSION ROWS CANNOT SAY IT. A mission row is keyed by the mission, the
-- UTC day and its own tile, so an unchanged mission seen at every pan is ONE row
-- a day, stamped with the first sighting. "No newer mission row" therefore means
-- either "gone" or "still there, unchanged" - most often the second. Dropping a
-- mission because a newer viewport exists would empty the list after every sweep.
--
-- WHAT SAYS IT INSTEAD. The viewport row (0148) is written per pan. From parser
-- 1.8.0 its raw carries `missions`: the uuid of every dispatch mission in that
-- window, an empty list when there were none. A mission is gone when a viewport
--   * of the same map,
--   * captured after the mission's last row,
--   * at viewLvl 1, with the mission's tile inside its window,
--   * that carries the list,
-- does not name it.
--
-- THE WINDOW is world_viewport_half_extent() (0148: 35 x 70 either side of the
-- centre, a rectangle - the committed 657-tile viewport fills its corners), taken
-- STRICTLY inside, one tile short of the edge on each side. Claiming less ground
-- than was seen leaves a departed mission listed a little longer; claiming more
-- would drop one that is standing. viewLvl 0 is a smaller window nobody has
-- measured, so it is not evidence here.
--
-- WHAT THIS DOES NOT DO.
--   * Nothing changes until the collector runs parser 1.8.0: a viewport row
--     without the list says nothing, and every row written before today lacks it.
--     No ordering hazard either way - the list rides in `raw`, so there is no
--     column for an old or a new parser to miss.
--   * A mission nobody looks at again stays until its finish instant, as before.
--     Absence is only known where the camera went back.
--   * It does not know how many steals a mission has left. The tile's fields for
--     that are not understood yet, so a mission plundered to its limit but still
--     standing is still listed.
--   * world_viewport_snapshots keeps only the newest row per camera centre
--     (0302). That is enough: any later look that lacks the mission is a witness,
--     and a mission does not come back.
--
-- Same columns, same order as 0334; only the last predicate is new.

create or replace view public.dispatch_missions_live
with (security_invoker = true) as
select latest.*,
       p.current_name as owner_name,
       al.current_code as alliance_abbr
  from (
    select distinct on (s.mission_uuid)
           s.mission_uuid,
           coalesce(
             case when (s.raw -> '103' ->> 0) ~ '^[0-9]{1,9}$'
                  then (s.raw -> '103' ->> 0)::int end,
             s.server_id) as server_id,
           s.point_id,
           s.x,
           s.y,
           s.mission_id,
           s.owner_game_uid,
           s.alliance_external_id,
           s.started_at,
           s.ends_at,
           s.captured_at as seen_at,
           g.color,
           g.star,
           g.orange_books,
           g.steal_max,
           g.is_special,
           g.steal_items
      from public.dispatch_mission_snapshots s
      join public.game_dispatch_missions g using (mission_id)
     where s.captured_at > now() - interval '1 day'
     order by s.mission_uuid, s.captured_at desc
  ) latest
  left join public.players p on p.game_uid = latest.owner_game_uid
  -- By id on any server: the alliance may be filed under the server it came
  -- from. The one on this map first, then the one seen last.
  left join lateral (
    select a.current_code
      from public.alliances a
     where a.external_id = latest.alliance_external_id
     order by (a.server_id = latest.server_id) desc, a.last_seen_at desc nulls last
     limit 1
  ) al on true
 where latest.ends_at > now()
   and not exists (
     select 1
       from public.world_viewport_snapshots v,
            public.world_viewport_half_extent() e
      where v.server_id = latest.server_id
        and v.captured_at > latest.seen_at
        and v.view_lvl = 1
        and abs(latest.x - v.center_x) < e.half_x
        and abs(latest.y - v.center_y) < e.half_y
        and jsonb_typeof(v.raw -> 'missions') = 'array'
        and not (v.raw -> 'missions' ? latest.mission_uuid)
   );

comment on view public.dispatch_missions_live is
  'Started dispatch missions whose finish instant has not passed (0254), with their colour '
  'and Orange Skill Book count from game_dispatch_missions and the owner''s name. server_id '
  'is the map the mission stands on, from the tile (0334). A mission is dropped once a later '
  'viewport over its tile lists the missions it saw and does not name it (0338).';
