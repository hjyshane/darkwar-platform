-- 0254: Dark Syndicate trucks and hero dispatch missions, for the map.
--
-- Two things on the world map are worth taking and neither was stored:
--
--   * TRUCKS. A truck is not a map tile: it is a march of type 15 that carries a
--     `train` object (push.world.march.new), and the list of trucks a player may
--     intercept comes back from train.list / get.train.info with the cargo.
--     The march names the current leg (`path`, start and end instants) and so the
--     position; the list names the cargo, the quality and the owner. They share the
--     truck's uuid, so they are stored as they arrive and joined in a view. Quality
--     is the game's 1-5 (grey, green, blue, purple, orange). Hero fragments only
--     ever came on quality 4 and 5 trucks, as items 210318 / 210319 / 210454.
--
--   * DISPATCH MISSIONS (the "plunder" missions). They ARE map tiles: object type
--     21, whose `f101` carries the mission uuid (f1), the mission id (f2), the
--     owner's uid as text (f3), the alliance id as text (f4), and - only once the
--     mission has been started - its start and finish instants in epoch
--     milliseconds (f5, f6). A mission with no f5/f6 has not been started and
--     cannot be plundered. The mission id is the key into the client's
--     aps_dispatch_tasks table: colour 2 blue, 3 purple, 4 gold, and what stealing
--     it yields (20 of the gold ones give an Orange Skill Book). That catalogue is
--     game_dispatch_missions (dw-collector game-dispatch), the same way 0248 holds
--     the event guide. (get.dispatch.mission.record was tried first and is history,
--     median 106 hours old: not a source for what is open now.)
--
-- Both are snapshot tables written by the collector, like every other capture, and
-- read by members. The views give the map what is still on the road or still open.
-- They are SECURITY INVOKER so the members-only policy applies to whoever reads
-- them (a definer view would run as its owner and keep the policy out of it).

create table public.world_truck_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- The truck's own server, not where it was seen from. No FK: a truck may belong
  -- to a server outside the tracked group, and a failed insert would stall the outbox.
  server_id int not null,
  -- Text: the game's uuid is a 19-digit number, past what a JSON reader keeps exactly.
  truck_uuid text not null,
  owner_game_uid text,
  owner_name text,
  alliance_abbr text,
  quality smallint,
  cfg_id int,
  completeness numeric,
  rob_times smallint,
  -- The leg it was on when the march was pushed: map points and the instants it
  -- left the one and reaches the other. Null on list rows.
  start_pos int,
  target_pos int,
  segment_start_at timestamptz,
  segment_end_at timestamptz,
  -- When the whole trip ends, and when it was sent.
  arrive_at timestamptz,
  send_at timestamptz,
  -- Null when the row says nothing about cargo (a march push does not).
  hero_fragments int,
  goods jsonb
);

create index world_truck_snapshots_truck_idx
  on public.world_truck_snapshots (server_id, truck_uuid, captured_at desc);

alter table public.world_truck_snapshots enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated everything,
-- TRUNCATE included (0207).
revoke all on public.world_truck_snapshots from anon, authenticated;
grant select on public.world_truck_snapshots to authenticated;
grant all on public.world_truck_snapshots to service_role;

create policy member_read on public.world_truck_snapshots
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.world_truck_snapshots is
  'Dark Syndicate trucks as the game reported them (0254): march pushes carry the '
  'position, train.list / get.train.info the cargo. Joined by world_trucks_latest.';

create table public.dispatch_mission_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- The map's server (the tile's f103), which is the owner's: a mission sits on
  -- its owner's own ground.
  server_id int not null,
  point_id bigint not null,
  x int not null,
  y int not null,
  mission_id int not null,
  mission_uuid text not null,
  owner_game_uid bigint,
  alliance_external_id text,
  -- Only started missions are stored; these are the game's own instants.
  started_at timestamptz not null,
  ends_at timestamptz not null
);

create index dispatch_mission_snapshots_mission_idx
  on public.dispatch_mission_snapshots (mission_uuid, captured_at desc);

alter table public.dispatch_mission_snapshots enable row level security;

revoke all on public.dispatch_mission_snapshots from anon, authenticated;
grant select on public.dispatch_mission_snapshots to authenticated;
grant all on public.dispatch_mission_snapshots to service_role;

create policy member_read on public.dispatch_mission_snapshots
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.dispatch_mission_snapshots is
  'Started hero dispatch missions seen on the world map (0254, object type 21): where each '
  'sits, which mission (mission_id, the key into game_dispatch_missions), whose, and the '
  'game''s own start and finish instants.';

create table public.game_dispatch_missions (
  mission_id int primary key,
  -- aps_dispatch_tasks.color: 2 blue, 3 purple, 4 gold.
  color smallint not null,
  star smallint,
  duration_seconds int not null check (duration_seconds > 0),
  steal_max int,
  is_special boolean not null default false,
  -- How many Orange Skill Books (item 230101) stealing it pays.
  orange_books int not null default 0,
  steal_items jsonb not null default '[]'::jsonb,
  base_items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.game_dispatch_missions enable row level security;

revoke all on public.game_dispatch_missions from anon, authenticated;
grant select on public.game_dispatch_missions to authenticated;
grant all on public.game_dispatch_missions to service_role;

create policy member_read on public.game_dispatch_missions
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.game_dispatch_missions is
  'The client''s aps_dispatch_tasks, reduced to what the map needs (0254): colour, how long it '
  'runs, and what stealing it pays. Written by dw-collector game-dispatch.';

-- Trucks still on the road: the newest position and the newest cargo, joined by uuid.
-- A day of snapshots is plenty (a truck is on the road for hours), and a truck that
-- reached its end more than five minutes ago is gone.
create view public.world_trucks_latest
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
         completeness, rob_times, arrive_at, hero_fragments, goods, captured_at
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
       -- Loots left are counted down by whichever reading is newer.
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
       c.captured_at as cargo_seen_at
  from pos p
  full join cargo c on c.server_id = p.server_id and c.truck_uuid = p.truck_uuid
 where coalesce(c.arrive_at, p.arrive_at) > now() - interval '5 minutes';

revoke all on public.world_trucks_latest from anon, authenticated;
grant select on public.world_trucks_latest to authenticated;
grant all on public.world_trucks_latest to service_role;

comment on view public.world_trucks_latest is
  'One row per truck still on the road (0254): newest position (march push) joined to newest '
  'cargo (train.list). position_seen_at / cargo_seen_at say how stale each half is; a truck '
  'seen only in the list has no position and cannot be drawn.';

-- Missions still open: the newest sighting of each, with its catalogue row and its
-- owner. ends_at is the game's own instant, not an estimate.
create view public.dispatch_missions_live
with (security_invoker = true) as
select latest.*,
       p.current_name as owner_name,
       a.current_code as alliance_abbr
  from (
    select distinct on (s.mission_uuid)
           s.mission_uuid,
           s.server_id,
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
  left join public.alliances a
         on a.server_id = latest.server_id and a.external_id = latest.alliance_external_id
 where latest.ends_at > now();

revoke all on public.dispatch_missions_live from anon, authenticated;
grant select on public.dispatch_missions_live to authenticated;
grant all on public.dispatch_missions_live to service_role;

comment on view public.dispatch_missions_live is
  'Started dispatch missions whose finish instant has not passed (0254), with their colour '
  'and Orange Skill Book count from game_dispatch_missions and the owner''s name.';
