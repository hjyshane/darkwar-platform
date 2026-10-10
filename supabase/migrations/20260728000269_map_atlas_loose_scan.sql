-- 0269: map_atlas reads each base's newest sighting by index, not by scanning the history.
--
-- map_atlas (0266) took its bases from latest_world_cities, a DISTINCT ON over
-- world_city_snapshots. For server 580 that is 162,796 snapshot rows, read to
-- keep 2,856, and it grows with every sweep. Measured on production it took
-- 4.3 s as the owner; as a signed-in reader, with the row policy evaluated per
-- row, it passed the authenticated role's 8 s statement_timeout and the map
-- page answered "canceling statement due to statement timeout".
--
-- THE SHAPE. world_city_server_uid_idx is (server_id, game_uid, captured_at
-- DESC). A loose index scan walks it one game_uid at a time (about 2,900 short
-- probes), and a lateral probe per uid takes the newest row. The cost follows
-- the number of bases, not the number of sightings ever recorded.
--
-- THE ANSWER IS UNCHANGED: the same row per (server_id, game_uid) that
-- latest_world_cities returns, the same membership rule as 0266, the same
-- jsonb. Only how the newest sighting is found differs.

create or replace function public.map_atlas(p_server_id int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with recursive uids as (
    (select w.game_uid
       from public.world_city_snapshots w
      where w.server_id = p_server_id
      order by w.game_uid
      limit 1)
    union all
    select (select w.game_uid
              from public.world_city_snapshots w
             where w.server_id = p_server_id and w.game_uid > u.game_uid
             order by w.game_uid
             limit 1)
      from uids u
     where u.game_uid is not null
  ),
  latest as (
    select l.*
      from uids u
      cross join lateral (
        select w.game_uid, w.player_id, w.x, w.y, w.hq_level, w.name,
               w.captured_at, w.shield_end_at
          from public.world_city_snapshots w
         where w.server_id = p_server_id and w.game_uid = u.game_uid
         order by w.captured_at desc
         limit 1) l
     where u.game_uid is not null
  ),
  seen as (
    select w.game_uid, w.x, w.y, w.hq_level, w.name, w.captured_at, w.shield_end_at,
           p.power, p.current_alliance_id as last_alliance_id
      from latest w
      left join public.players p on p.player_id = w.player_id
  ),
  -- Newest roster per alliance on this map, where it is complete enough to trust.
  roster as (
    select r.alliance_id, r.game_uid
      from public.alliance_roster_latest r
     where r.alliance_id in (select last_alliance_id from seen where last_alliance_id is not null)
       and (r.snapshot_complete
            or r.observed_members >= floor(r.expected_members * 0.95))
  ),
  rostered as (select distinct alliance_id from roster),
  b as (
    select s.game_uid, s.x, s.y, s.hq_level, s.name, s.captured_at, s.shield_end_at, s.power,
           case
             when s.last_alliance_id is null then null
             when not exists (select 1 from rostered x where x.alliance_id = s.last_alliance_id)
               then s.last_alliance_id
             when exists (select 1 from roster r
                           where r.alliance_id = s.last_alliance_id and r.game_uid = s.game_uid)
               then s.last_alliance_id
             else null
           end as alliance_id
      from seen s
  ),
  a as (
    select al.alliance_id, al.current_code, al.current_name,
           count(*) as bases,
           coalesce(sum(b.power), 0) as power,
           row_number() over (order by count(*) desc, al.current_code) - 1 as ord
      from b
      join public.alliances al on al.alliance_id = b.alliance_id
     group by al.alliance_id, al.current_code, al.current_name
  )
  select jsonb_build_object(
    'alliances', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.alliance_id, 'code', a.current_code, 'name', a.current_name,
               'bases', a.bases, 'power', a.power) order by a.ord)
        from a), '[]'::jsonb),
    'bases', coalesce((
      select jsonb_agg(jsonb_build_array(
               b.game_uid, b.x, b.y, b.hq_level, b.power, coalesce(a.ord, -1),
               extract(epoch from b.captured_at)::bigint, b.name,
               extract(epoch from b.shield_end_at)::bigint))
        from b left join a on a.alliance_id = b.alliance_id), '[]'::jsonb)
  );
$$;

comment on function public.map_atlas(int) is
  'A server''s swept bases with the alliance each belongs to NOW, plus the alliance ranking, as one jsonb (0260; shield 0262; current members only 0266; newest sighting by loose index scan 0269).';
