-- 0002: servers, player/alliance identity, and app users.
-- game_identity_links is deferred: the link flow (§6.2 step 3) depends on an
-- unconfirmed in-game message command.

-- Natural integer key: it is the in-game ID, human-readable in logs and
-- URLs, small in every index, and the leading column of hot indexes
-- (NFR-007). Merges add rows and set merged_into_server_id — no schema
-- change at 12/16/32/64 servers.
create table public.servers (
  server_id int primary key,
  server_group text not null,
  merged_into_server_id int references public.servers (server_id),
  is_tracked boolean not null default true,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger servers_set_updated_at
  before update on public.servers
  for each row execute function public.set_updated_at();

-- Operational fact, not test data — the tracked group exists in production,
-- which is why these rows live in a migration and not in seed.sql.
insert into public.servers (server_id, server_group)
select s, '577-584' from generate_series(577, 584) as s;

create table public.alliances (
  alliance_id uuid primary key default gen_random_uuid(),
  server_id int not null references public.servers (server_id),
  external_id bigint not null,
  current_name text,
  current_code text,
  power bigint,
  member_count int,
  leader_player_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (server_id, external_id)
);

create trigger alliances_set_updated_at
  before update on public.alliances
  for each row execute function public.set_updated_at();

-- Open decision D-1 resolved toward the cheap-to-reverse side: game_uid is
-- globally unique across the server group (server.rank returns cross-server
-- rankings in one response, and merges make (server_id, game_uid) unstable).
-- If the legacy SQLite disproves this, one migration adds server_id to the
-- unique constraint; the reverse direction would split merged players.
create table public.players (
  player_id uuid primary key default gen_random_uuid(),
  game_uid bigint not null unique,
  server_id int not null references public.servers (server_id),
  current_name text,
  current_alliance_id uuid references public.alliances (alliance_id),
  hq_level int,
  power bigint,
  kills bigint,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

create index players_server_power_idx
  on public.players (server_id, power desc nulls last);
create index players_alliance_idx
  on public.players (current_alliance_id)
  where current_alliance_id is not null;

alter table public.alliances
  add constraint alliances_leader_player_id_fkey
  foreign key (leader_player_id) references public.players (player_id);

-- Name history (FR-CORE-001): one row per distinct name observed.
create table public.player_names (
  player_name_id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (player_id),
  name text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  unique (player_id, name)
);

create table public.alliance_names (
  alliance_name_id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references public.alliances (alliance_id),
  name text not null,
  code text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  unique (alliance_id, name)
);

-- Application role attached to a Supabase auth user. Collector and analyst
-- services authenticate with the secret key (bypassing RLS), so rows here
-- are humans; the service enum values exist for audit attribution.
create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'viewer',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();
