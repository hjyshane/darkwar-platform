-- 0258: where a foreign truck is, worked out from its route.
--
-- 0257 could only draw a foreign truck where it set off from. The interception
-- list says more than that: each truck carries its route as station numbers
-- (`stationList`), the station it is heading for (`marchInfo.lastPosIndex`) and
-- when that leg starts and ends (`lastSendTime`, `nextEndTime`). Station numbers
-- are map points, learned from the truck marches the collector does receive (its
-- own server's): the leg to `stationList[i]` starts at `stationList[i - 1]`, which
-- gave exactly one point per station over 8,784 pushes. The layout is shared:
-- 2,343 legs of trucks from servers 577-588 cover station distance in leg time at
-- 0.25 tiles/s, the truck speed. So the table below places every server's trucks.
-- `dw-collector train-stations` fills it from the journal.

alter table public.world_truck_snapshots
  add column stations jsonb,
  add column station_index smallint,
  add column leg_start_at timestamptz,
  add column leg_end_at timestamptz;

create table public.game_train_stations (
  station_no int primary key,
  point_id int not null,
  x int not null,
  y int not null,
  updated_at timestamptz not null default now()
);

alter table public.game_train_stations enable row level security;

revoke all on public.game_train_stations from anon, authenticated;
grant select on public.game_train_stations to authenticated;
grant all on public.game_train_stations to service_role;

create policy member_read on public.game_train_stations
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.game_train_stations is
  'Dark Syndicate truck stations by number, with the map point each sits on (0258). Learned '
  'from truck march pushes by dw-collector train-stations.';

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
         completeness, rob_times, arrive_at, hero_fragments, goods, start_pos,
         stations, station_index, leg_start_at, leg_end_at, captured_at
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
       c.start_pos as origin_pos,
       c.stations,
       c.station_index,
       c.leg_start_at,
       c.leg_end_at
  from pos p
  full join cargo c on c.server_id = p.server_id and c.truck_uuid = p.truck_uuid
 where coalesce(c.arrive_at, p.arrive_at) > now() - interval '5 minutes';

comment on view public.world_trucks_latest is
  'One row per truck still on the road (0254): newest position (march push) joined to newest '
  'cargo (train.list). origin_pos (0257) is where the list says it set off from. stations / '
  'station_index / leg_start_at / leg_end_at (0258) are its route and current leg, to be read '
  'with game_train_stations.';
