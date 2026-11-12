-- 0321: a sighting ON this map outranks players.server_id.
--
-- 0319 dropped a base whose player row says another server. That also dropped a
-- player who had just migrated IN: the sweep saw their base on the 580 map
-- (map_server_id = 580, 0318), but players.server_id still named the old
-- server until a board or roster was read again. The rule now applies to OLD
-- rows only (map_server_id null), which carry no map evidence of their own.
-- A new row is the map itself saying the base is here.

create or replace function public.map_atlas(p_server_id int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with recursive
  -- uids with a sighting on this map: new rows by map_server_id, old rows
  -- (map_server_id null) by their home server. Two loose index scans.
  uids_new as (
    (select w.game_uid
       from public.world_city_snapshots w
      where w.map_server_id = p_server_id
      order by w.game_uid
      limit 1)
    union all
    select (select w.game_uid
              from public.world_city_snapshots w
             where w.map_server_id = p_server_id and w.game_uid > u.game_uid
             order by w.game_uid
             limit 1)
      from uids_new u
     where u.game_uid is not null
  ),
  uids_old as (
    (select w.game_uid
       from public.world_city_snapshots w
      where w.server_id = p_server_id and w.map_server_id is null
      order by w.game_uid
      limit 1)
    union all
    select (select w.game_uid
              from public.world_city_snapshots w
             where w.server_id = p_server_id and w.map_server_id is null
               and w.game_uid > u.game_uid
             order by w.game_uid
             limit 1)
      from uids_old u
     where u.game_uid is not null
  ),
  uids as (
    select game_uid from uids_new where game_uid is not null
    union
    select game_uid from uids_old where game_uid is not null
  ),
  latest as (
    select l.*
      from uids u
      cross join lateral (
        select w.game_uid, w.player_id, w.x, w.y, w.hq_level, w.name,
               w.captured_at, w.shield_end_at, w.map_server_id
          from public.world_city_snapshots w
         where w.game_uid = u.game_uid
           and coalesce(w.map_server_id, w.server_id) = p_server_id
         order by w.captured_at desc
         limit 1) l
     -- gone: the same uid was seen on a different map after this sighting
     where not exists (
       select 1 from public.world_city_snapshots o
        where o.game_uid = u.game_uid
          and o.captured_at > l.captured_at
          and coalesce(o.map_server_id, o.server_id) <> p_server_id)
  ),
  seen as (
    select w.game_uid, w.x, w.y, w.hq_level, w.name, w.captured_at, w.shield_end_at,
           p.power, p.current_alliance_id as last_alliance_id
      from latest w
      left join public.players p on p.player_id = w.player_id
     -- a player the collector has read on ANOTHER server has moved: their base
     -- here is the one they left. Unknown (no player row, no server) stays.
     where w.map_server_id is not null or p.server_id is null or p.server_id = p_server_id
  ),
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
  'A server''s swept bases with the alliance each belongs to NOW, plus the alliance ranking, as one jsonb (0260; shield 0262; current members only 0266; loose index scan 0269; a base follows the map it was seen on 0318; a player known to live on another server is not on this map unless seen here 0321).';
