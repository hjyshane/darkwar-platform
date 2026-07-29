-- 0003: snapshot tables for the confirmed commands (Appendix B).
--
-- Every snapshot table carries the convention columns pinned in CLAUDE.md:
-- observation_id, source_command, parser_version, idempotency_key (unique),
-- captured_at, raw jsonb — plus provenance (collector_id,
-- collected_from_server_id). idempotency_key hashes the RAW decoded payload,
-- never the normalized row; there is a pgTAP + pytest regression pinning it.
--
-- server_id is the SUBJECT's server, not the observation's: a server.rank
-- response captured from 580 contains players from all eight servers.
-- Provenance lives in collector_id / collected_from_server_id.
--
-- Typed columns cover only fields observed consistently in v0.4.1;
-- everything else lands in raw with no migration and is promoted later.
-- collector_id FKs are added in 0004 once collectors exists.

create table public.player_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null,
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  player_id uuid not null references public.players (player_id),
  server_id int not null references public.servers (server_id),
  game_uid bigint not null,
  name text,
  alliance_external_id text,
  hq_level int,
  power bigint,
  kills bigint,
  rank int
);

create index player_snapshots_server_captured_idx
  on public.player_snapshots (server_id, captured_at desc);
create index player_snapshots_player_captured_idx
  on public.player_snapshots (player_id, captured_at desc);

-- FR-CORE-004: six component powers must sum to total power. Component
-- field names are not confirmed until the v0.4.1 parser is promoted (S14),
-- so components stay jsonb; only the verification result is typed.
create table public.player_detail_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null,
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  player_id uuid not null references public.players (player_id),
  server_id int not null references public.servers (server_id),
  game_uid bigint not null,
  power_total bigint,
  power_components jsonb not null default '{}'::jsonb,
  components_sum_matches boolean
);

create index player_detail_snapshots_server_captured_idx
  on public.player_detail_snapshots (server_id, captured_at desc);
create index player_detail_snapshots_player_captured_idx
  on public.player_detail_snapshots (player_id, captured_at desc);

create table public.alliance_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null,
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  alliance_id uuid not null references public.alliances (alliance_id),
  server_id int not null references public.servers (server_id),
  external_id text not null,
  name text,
  code text,
  power bigint,
  member_count int,
  leader_game_uid bigint,
  rank int
);

create index alliance_snapshots_server_captured_idx
  on public.alliance_snapshots (server_id, captured_at desc);
create index alliance_snapshots_alliance_captured_idx
  on public.alliance_snapshots (alliance_id, captured_at desc);

-- Roster at a point in time (al.rank). player_id is filled once the player
-- is known; the row must still land when it is not. FR-CORE-003: redacted
-- presence of other alliances must never masquerade as a real online state.
create table public.alliance_member_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null,
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  alliance_id uuid not null references public.alliances (alliance_id),
  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  name text,
  member_rank int,
  hq_level int,
  power bigint,
  kills bigint,
  presence_redacted boolean not null default false,
  online_state text
);

create index alliance_member_snapshots_server_captured_idx
  on public.alliance_member_snapshots (server_id, captured_at desc);
create index alliance_member_snapshots_alliance_captured_idx
  on public.alliance_member_snapshots (alliance_id, captured_at desc);
create index alliance_member_snapshots_player_captured_idx
  on public.alliance_member_snapshots (player_id, captured_at desc)
  where player_id is not null;

-- FR-CORE-005 keeps weekly matches and ranking snapshots separate.
create table public.arena_matches (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null,
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  server_id int not null references public.servers (server_id),
  week_start timestamptz not null,
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  opponent_game_uid bigint,
  opponent_name text
);

create index arena_matches_server_week_idx
  on public.arena_matches (server_id, week_start desc);
create index arena_matches_player_week_idx
  on public.arena_matches (player_id, week_start desc)
  where player_id is not null;

-- Ranking header; the ranked rows live in arena_entries.
create table public.arena_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null,
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  server_id int not null references public.servers (server_id),
  week_start timestamptz not null,
  entry_count int
);

create index arena_snapshots_server_week_idx
  on public.arena_snapshots (server_id, week_start desc, captured_at desc);

create table public.arena_entries (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null,
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  arena_snapshot_id uuid not null
    references public.arena_snapshots (snapshot_id) on delete cascade,
  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  name text,
  rank int not null,
  score int,
  defense_power bigint
);

create index arena_entries_parent_rank_idx
  on public.arena_entries (arena_snapshot_id, rank);
create index arena_entries_server_captured_idx
  on public.arena_entries (server_id, captured_at desc);
create index arena_entries_player_captured_idx
  on public.arena_entries (player_id, captured_at desc)
  where player_id is not null;
