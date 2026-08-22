-- 0138: members' season buildings, as seen on the world map.
--
-- This is the surface the alliance actually asked for — who has built what,
-- and how far each building has been levelled — and it took three wrong
-- answers to get here, so the evidence is written down rather than trusted.
--
-- The object is map type 6. It was recorded in this repo as "marches",
-- because one uid appears at one city coordinate and at many scattered
-- type-6 ones at the same moment, which reads like an army on the move. It
-- is a player's several buildings sitting at DIFFERENT alliance centres. A
-- capture of 22 buildings clicked one at a time settled it: every clicked
-- tile was type 6, all 22 matched their owner's uid, and they clustered
-- around two of the alliance's three centres.
--
-- `level` is the field that survived the test the others failed. Across
-- 1,720 objects re-observed on more than one day it moved 1,536 times and
-- EVERY MOVE WAS UPWARD — zero decreases. Type 21's lookalike field failed
-- the same test three ways (never changed per object, symmetric per
-- coordinate, flat population mean over 19 days), which is why type 21 is
-- not in this schema.
--
-- `building_type_id` is the game's own id and is NOT translated. The map
-- shows 18 distinct values while the alliance describes eleven buildings,
-- one of them pass-locked; naming them here would be a guess, so the id
-- travels as-is and a catalogue can name it when somebody reads the ids off
-- the screen.

create table public.season_building_snapshots (
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

  -- The OWNER's server, decoded from their uid (D-1). A season map carries
  -- players from the whole season group, not just the tracked servers.
  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,

  -- The building's own id, stable across days and never seen to change
  -- owner or type. This is what makes a levelling history a history of one
  -- building rather than of one patch of ground: a coordinate can be
  -- rebuilt on, an object cannot.
  object_id bigint,

  point_id bigint not null,
  x int not null,
  y int not null,

  building_type_id int,
  level int
);

create index season_building_server_captured_idx
  on public.season_building_snapshots (server_id, captured_at desc);
-- "How is this member doing" — the alliance's actual question.
create index season_building_uid_captured_idx
  on public.season_building_snapshots (game_uid, captured_at desc);
create index season_building_player_captured_idx
  on public.season_building_snapshots (player_id, captured_at desc)
  where player_id is not null;
-- One building's levelling history.
create index season_building_object_captured_idx
  on public.season_building_snapshots (object_id, captured_at desc)
  where object_id is not null;

alter table public.season_building_snapshots enable row level security;

grant select on public.season_building_snapshots to authenticated;
grant all on public.season_building_snapshots to service_role;

create policy member_read on public.season_building_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create trigger season_building_snapshots_notify
  after insert on public.season_building_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

comment on column public.season_building_snapshots.level is
  'Building level from the map tile. Monotonic in the data it was '
  'established from: 1,536 increases and zero decreases across 1,720 '
  'objects re-observed on more than one day.';

comment on column public.season_building_snapshots.building_type_id is
  'The game''s own building id, untranslated. 18 distinct values observed '
  'against eleven buildings described in game, so the mapping is not known '
  'and must not be invented.';
