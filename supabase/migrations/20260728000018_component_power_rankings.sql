-- 0018: component power boards (rank.get.by.range).
--
-- Four boards share one command, distinguished by `type`. What each type
-- measures was established from the payload, not from capture order:
--
--   45 -> the collector's selfPower is 70,857,050, EXACTLY the heroPower in
--         its own get.new.user.info profile
--   79 -> selfPower 7,977,471, EXACTLY that profile's petPower
--   49 -> entries carry `heroId`: a board about ONE hero, so "strongest"
--   80 -> entries carry `petId`: likewise, one pet
--
-- An earlier note in the capture backlog had 49 and 79 the other way round,
-- inferred from the order the tabs were opened. The exact profile match and
-- the heroId/petId fields overrule that; the note is corrected in the same
-- commit as this migration.
--
-- These are NOT player_snapshots.power. The collector's total power is
-- 344,948,617 while these four are 70.8M / 7.9M / 7.0M / 3.1M, and they do
-- not sum to it. Writing any of them into the roster's power column would
-- report players at a fraction of their strength — the exact corruption the
-- backlog warned about when the types were unknown.
--
-- A separate table rather than columns on player_snapshots: a board carries
-- ONE metric per player, so four boards would leave three columns null on
-- every row, and (game_uid, metric) is the natural grain.

create table public.player_component_power_snapshots (
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

  -- The subject's server (schema conventions), decoded from the uid.
  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  metric text not null
    check (metric in ('hero_power_total', 'hero_power_best',
                      'pet_power_total', 'pet_power_best')),
  power bigint,
  rank int,
  -- The raw `type` id, kept so a future board (a fifth type) is traceable
  -- back to the response even after `metric` naming settles.
  board_type int not null,
  name text,
  alliance_name text,
  alliance_abbr text,
  -- The specific hero/pet the "best" boards rank. Null on the totals, which
  -- name no single unit.
  unit_id int
);

create index player_component_power_server_idx
  on public.player_component_power_snapshots (server_id, metric, captured_at desc);
create index player_component_power_player_idx
  on public.player_component_power_snapshots (player_id, metric, captured_at desc)
  where player_id is not null;

alter table public.player_component_power_snapshots enable row level security;

grant select on public.player_component_power_snapshots to anon, authenticated;
grant all on public.player_component_power_snapshots to service_role;

-- Same visibility as the other cross-server boards: every player sees these
-- rankings in the game client.
create policy public_read on public.player_component_power_snapshots
  for select to anon, authenticated using (true);

create trigger player_component_power_snapshots_notify
  after insert on public.player_component_power_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();
