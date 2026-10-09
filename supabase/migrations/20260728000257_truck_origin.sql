-- 0257: where a truck set off from, for trucks whose road was never seen.
--
-- world_trucks_latest (0254) took a truck's position only from the march push,
-- and a push arrives only for marches the collector's account was told about -
-- in practice its own server's. The interception list covers the whole group
-- (servers 577-588) and carries `startPos` for each truck: the place it left.
-- That is not where it is now, but it is the one coordinate known for a foreign
-- truck, so the view now carries it as `origin_pos` and the map can draw it as
-- "left from here" instead of drawing nothing.
--
-- Same body as 0254 with one column appended; create or replace allows exactly
-- that and keeps the grants.

create or replace view public.world_trucks_latest
with (security_invoker = true) as
with recent as (
  select * from public.world_truck_snapshots where captured_at > now() - interval '1 day'
),
pos as (
  select distinct on (server_id, truck_uuid)
         server_id, truck_uuid, owner_game_uid, owner_name, alliance_abbr, quality, cfg_id,
         rob_times, start_pos, target_pos, segment_start_at, segment_end_at, arrive_at,
         captured_at
    from recent
   where segment_end_at is not null
   order by server_id, truck_uuid, captured_at desc
),
cargo as (
  select distinct on (server_id, truck_uuid)
         server_id, truck_uuid, owner_game_uid, owner_name, alliance_abbr, quality, cfg_id,
         completeness, rob_times, arrive_at, hero_fragments, goods, start_pos, captured_at
    from recent
   where goods is not null
   order by server_id, truck_uuid, captured_at desc
)
select coalesce(c.server_id, p.server_id) as server_id,
       coalesce(c.truck_uuid, p.truck_uuid) as truck_uuid,
       coalesce(c.owner_game_uid, p.owner_game_uid) as owner_game_uid,
       coalesce(c.owner_name, p.owner_name) as owner_name,
       coalesce(c.alliance_abbr, p.alliance_abbr) as alliance_abbr,
       coalesce(c.quality, p.quality) as quality,
       coalesce(c.cfg_id, p.cfg_id) as cfg_id,
       c.completeness,
       case when c.captured_at is null or p.captured_at > c.captured_at
            then coalesce(p.rob_times, c.rob_times)
            else coalesce(c.rob_times, p.rob_times) end as rob_times,
       p.start_pos,
       p.target_pos,
       p.segment_start_at,
       p.segment_end_at,
       coalesce(c.arrive_at, p.arrive_at) as arrive_at,
       coalesce(c.hero_fragments, 0) as hero_fragments,
       c.goods,
       p.captured_at as position_seen_at,
       c.captured_at as cargo_seen_at,
       c.start_pos as origin_pos
  from pos p
  full join cargo c on c.server_id = p.server_id and c.truck_uuid = p.truck_uuid
 where coalesce(c.arrive_at, p.arrive_at) > now() - interval '5 minutes';

comment on view public.world_trucks_latest is
  'One row per truck still on the road (0254): newest position (march push) joined to newest '
  'cargo (train.list). position_seen_at / cargo_seen_at say how stale each half is; origin_pos '
  '(0257) is where the list says it set off from, the only coordinate a truck with no march has.';
