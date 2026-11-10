-- 0317: a player's 1-4 squad power, from the squad that escorts a truck.
--
-- A truck listed by train.list / get.train.info (0254) carries `marchInfo` with
-- the squad its owner sent along: `squadNo`, `power` and `heroInfo` (five
-- heroes, each with a power). `power` is the squad's field combat power - the
-- number the arena shows, hero + troops + science, hero and vehicle buffs
-- together - and this is the only place another player's squad power arrives
-- with its squad number. It is NOT `get.new.user.info`.power (total power,
-- 764M for a player whose single squad reads 1.76G).
--
-- Checked 2026-11-10 against two arena lineups with the identical hero set:
-- 407.8M against 388.3M and 134.8M against 137.8M. Two pairs, so the same KIND
-- of number rather than proven the same number; compare more before a screen
-- leans on the last digits.
--
-- WHY NOT COLUMNS ON world_truck_snapshots. 0302 keeps only the newest row of
-- each truck, which would throw the squad's history away with the truck. Power
-- over time is the point, so it gets a table with its own life.
--
-- ONE SQUAD PER SIGHTING, NOT ALL FOUR. A truck shows the squad the owner chose
-- for it, so a player's four squads arrive one truck at a time. The view folds
-- them to one row per player (a screen that counts people must get one row per
-- person: PostgREST caps responses at 1,000 and drops entities silently, 0144),
-- and each squad keeps its own seen_at so a stale one says so.
--
-- Read by members only. The 'community' role (0283) is not on the allowlist and
-- stays closed to it: this is another alliance's strength, not reference data.

create table public.player_squad_power_snapshots (
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

  -- The OWNER's server, not where the truck was seen from. No FK, as 0254: a
  -- truck may belong to a server outside the tracked group and a failed insert
  -- would stall the outbox.
  server_id int not null,
  -- The game's own uid, like world_city_snapshots: the player row may not exist
  -- yet for someone only ever seen on a truck.
  game_uid bigint not null,
  squad_no smallint not null,
  power bigint not null,
  -- [{slot, hero_id, level, power, rank_lv}], by slot. A hero's own power is
  -- here; the troops and buffs are what makes up the rest of `power`.
  heroes jsonb not null default '[]'::jsonb,
  -- Text: the game's uuid is a 19-digit number, past what a JSON reader keeps
  -- exactly. Which truck showed us this, for tracing.
  truck_uuid text not null
);

-- server_id leads: the group grows to 12/16/32/64 servers.
create index player_squad_power_snapshots_squad_idx
  on public.player_squad_power_snapshots (server_id, game_uid, squad_no, captured_at desc);

alter table public.player_squad_power_snapshots enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated everything,
-- TRUNCATE included (0207).
revoke all on public.player_squad_power_snapshots from anon, authenticated;
grant select on public.player_squad_power_snapshots to authenticated;
grant all on public.player_squad_power_snapshots to service_role;

create policy member_read on public.player_squad_power_snapshots
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.player_squad_power_snapshots is
  'The squad that escorted a Dark Syndicate truck (0317): squad_no 1-4, its field combat '
  'power (the arena number, not total power) and its five heroes. One squad per truck '
  'sighting; player_squads_latest folds the newest of each squad into one row per player.';

-- One row per player: the newest reading of each squad seen, keyed by squad number.
--
--   squads  {"1": {"power": 1766291942, "seen_at": "...", "heroes": [...]}, "2": {...}}
--
-- A squad nobody has sent with a truck is simply absent, never zero.
-- No time window: a squad's power is the last one known and seen_at says how
-- old that is. `player_name` is null for someone only ever seen on a truck.
create view public.player_squads_latest
with (security_invoker = true) as
select latest.server_id,
       latest.game_uid,
       p.current_name as player_name,
       jsonb_object_agg(
         latest.squad_no::text,
         jsonb_build_object(
           'power', latest.power,
           'seen_at', latest.captured_at,
           'heroes', latest.heroes
         )
       ) as squads,
       count(*)::int as squad_count,
       max(latest.captured_at) as seen_at
  from (
    select distinct on (s.server_id, s.game_uid, s.squad_no)
           s.server_id, s.game_uid, s.squad_no, s.power, s.heroes, s.captured_at
      from public.player_squad_power_snapshots s
     order by s.server_id, s.game_uid, s.squad_no, s.captured_at desc
  ) latest
  -- game_uid alone, as 0254's dispatch view: it is unique on players, and a
  -- player who migrated servers still has the name.
  left join public.players p on p.game_uid = latest.game_uid
 group by latest.server_id, latest.game_uid, p.current_name;

revoke all on public.player_squads_latest from anon, authenticated;
grant select on public.player_squads_latest to authenticated;
grant all on public.player_squads_latest to service_role;

comment on view public.player_squads_latest is
  'One row per player (0317): squads is {"1": {power, seen_at, heroes}, ...} holding the '
  'newest reading of each squad seen. Squads never seen are absent, not zero. power is the '
  'arena (field combat) number; seen_at is per squad, and the row''s seen_at is the newest.';
