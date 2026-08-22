-- 0137: player cities as seen on the world map.
--
-- One row per city per viewport that saw it. `world.get.new` returns up to
-- 657 tiles at a time and a pan covers the same ground repeatedly, so this
-- table grows by observation, not by player — the same shape as every other
-- snapshot table here.
--
-- ONLY THE CITY TYPE IS STORED. A viewport carries fourteen object types and
-- exactly one of them is decoded with confidence: `f2 = 3`, whose uid, name
-- and HQ level are each pinned against something the viewport cannot say on
-- its own (protocol/worldmap.py records the counts). The rest — resources,
-- marches, alliance buildings, and the eight nobody has opened — are not
-- written anywhere yet, because a column for a field whose meaning is a
-- guess is exactly what CLAUDE.md refuses.
--
-- In particular type 21 is NOT here. It carries an owner uid and a spec
-- whose trailing digits run 1-4, so it reads like a levelled season
-- building; two tests say otherwise (0 of 19,983 fixed objects ever changed
-- spec, and same-owner transitions were symmetric 457 up / 396 down). Adding
-- it as "member building level" would have shipped a wrong number to 94
-- people.

create table public.world_city_snapshots (
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

  -- The subject's server, decoded from the uid's trailing six digits (D-1),
  -- not the `f103` the tile carries. The map is a season map and reaches
  -- servers outside the tracked group exactly as the season boards do; the
  -- uid is the field that says whose city this is.
  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,

  -- THE COORDINATE IS THE OBJECT'S IDENTITY on this map. `pointId` packs it
  -- as x * 1000 + y — `point` equals `pointId` in 543/543 opened details and
  -- both equal the viewport's own field on every opened tile. x and y are
  -- stored beside it because every query the map makes is a box, and
  -- unpacking in SQL would make those queries unindexable.
  point_id bigint not null,
  x int not null,
  y int not null,

  name text,
  -- Matches the roster's own hq_level exactly in 349/394 players; the rest
  -- differ by 1-2, which is a player levelling between the two captures.
  hq_level int
);

-- server_id leads, per the schema conventions.
create index world_city_server_captured_idx
  on public.world_city_snapshots (server_id, captured_at desc);
create index world_city_player_captured_idx
  on public.world_city_snapshots (player_id, captured_at desc)
  where player_id is not null;
-- "Where is this member" is a uid lookup for the newest sighting.
create index world_city_uid_captured_idx
  on public.world_city_snapshots (game_uid, captured_at desc);
-- "What is in this part of the map" is a box, which is why x and y are
-- columns rather than an expression over point_id.
create index world_city_box_idx
  on public.world_city_snapshots (server_id, x, y);

alter table public.world_city_snapshots enable row level security;

grant select on public.world_city_snapshots to authenticated;
grant all on public.world_city_snapshots to service_role;

-- Member-only, per 0065. A map of where every player lives is exactly the
-- sort of thing that should not be readable signed out.
create policy member_read on public.world_city_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create trigger world_city_snapshots_notify
  after insert on public.world_city_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

comment on column public.world_city_snapshots.point_id is
  'The game''s own tile id, which IS the coordinate: x * 1000 + y. Kept '
  'alongside x and y so a row can be matched back to the payload that '
  'produced it.';

comment on column public.world_city_snapshots.hq_level is
  'Headquarters level from the map tile (f3.4). Matched the roster''s '
  'hq_level exactly in 349/394 players when the decode was established.';
