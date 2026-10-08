-- 0250: what the state-migration screen offers, per server, and the rules it runs
-- on - so the Migration tab can show them the day the game turns the screen on.
--
-- The client already carries the whole screen (67 Lua scripts in the install
-- pack) behind `function_on_config.immigration_new`, which is 0. It reads two
-- things (normalize/migration_servers.py, normalize/migration_config.py):
--
--   * the rules, in `init`'s dataConfig: four migrate-power cutoffs and the
--     bracket / quota parameters. Real, captured since the first login.
--   * the offer, from `get.migrate.servers`: per server the seats left per level,
--     the power floors, the president's ceilings, intake used and allowed. NOT yet
--     seen - the field names come from the client's own parser and the first live
--     capture will confirm or correct them. Every typed column is nullable and the
--     whole entry is kept in `raw`, so a wrong guess costs a parser fix, not data.
--
--   * migration_config_snapshots: one row per distinct config per UTC day.
--   * migration_server_snapshots: one row per server per distinct state per hour.
--     `server_id` is the OFFERING server (where a mover would go), as everywhere:
--     the subject's server, not the capture's. No foreign key to `servers` - the
--     offer lists whatever servers the game does, and a row for one the group does
--     not track must not dead-letter the sync.
--   * migration_server_quotas(): the newest row per server, one row per server so
--     PostgREST's 1,000-row cap cannot cut it.
--
-- Read like the rest of the migration board (0191): officers and admins only.

create table public.migration_config_snapshots (
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

  -- aps_migrate_server.k6: the cutoffs between the four levels.
  power_tier_floors bigint[],
  -- aps_migrate_server.k2: one group of power brackets per level.
  power_brackets jsonb,
  -- function_on_config.immigration_new: whether the new screen is on.
  new_migrate_on boolean
);

create index migration_config_snapshots_latest_idx
  on public.migration_config_snapshots (captured_at desc);

create table public.migration_server_snapshots (
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

  server_id int not null,
  season int,
  season_group int,
  server_rank_type int,
  total_count int,
  use_count int,
  -- Seats left, keyed by level type: {"1": 20, "2": 15, ...}.
  migrate_left jsonb,
  special_left jsonb,
  invite_left jsonb,
  -- The power floor per level, in the client's order.
  power_low_limit bigint[],
  power_limit bigint,
  special_power_limit bigint,
  target_power_limit bigint,
  max_power bigint,
  need_item_id int,
  need_item_num int,
  target_open_at timestamptz,
  king_name text,
  king_uid text
);

create index migration_server_snapshots_latest_idx
  on public.migration_server_snapshots (server_id, captured_at desc);

alter table public.migration_config_snapshots enable row level security;
alter table public.migration_server_snapshots enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated
-- everything, TRUNCATE included (0207).
revoke all on public.migration_config_snapshots from anon, authenticated;
revoke all on public.migration_server_snapshots from anon, authenticated;
grant select on public.migration_config_snapshots to authenticated;
grant select on public.migration_server_snapshots to authenticated;
grant all on public.migration_config_snapshots to service_role;
grant all on public.migration_server_snapshots to service_role;

-- Enumerated roles, not a capability: the same reason as migration_events (0191).
create policy officer_read on public.migration_config_snapshots
  for select to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_read on public.migration_server_snapshots
  for select to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));

comment on table public.migration_config_snapshots is
  'The migration rules from init''s dataConfig (0250): the four power cutoffs, '
  'the bracket groups and whether the new screen is on. Written by the collector.';
comment on table public.migration_server_snapshots is
  'What get.migrate.servers offered per server (0250): seats left per level, power '
  'floors and ceilings, intake used. Field names come from the client''s parser and '
  'were not yet confirmed against a live response. server_id is the offering server.';

create function public.migration_server_quotas()
returns table (
  server_id int,
  captured_at timestamptz,
  season int,
  season_group int,
  server_rank_type int,
  total_count int,
  use_count int,
  migrate_left jsonb,
  special_left jsonb,
  invite_left jsonb,
  power_low_limit bigint[],
  power_limit bigint,
  special_power_limit bigint,
  target_power_limit bigint,
  max_power bigint,
  need_item_id int,
  need_item_num int,
  target_open_at timestamptz,
  king_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (s.server_id)
         s.server_id, s.captured_at, s.season, s.season_group, s.server_rank_type,
         s.total_count, s.use_count, s.migrate_left, s.special_left, s.invite_left,
         s.power_low_limit, s.power_limit, s.special_power_limit, s.target_power_limit,
         s.max_power, s.need_item_id, s.need_item_num, s.target_open_at, s.king_name
    from public.migration_server_snapshots s
   order by s.server_id, s.captured_at desc;
$$;

-- Postgres grants EXECUTE to PUBLIC at creation, and the hosted default
-- privileges hand it to anon as well (0207): revoke both by name.
revoke all on function public.migration_server_quotas() from public, anon, authenticated;
grant execute on function public.migration_server_quotas() to authenticated, service_role;

comment on function public.migration_server_quotas() is
  'The newest migration_server_snapshots row per server (0250): one row per server, '
  'read as the caller, so only officers and admins get any.';
