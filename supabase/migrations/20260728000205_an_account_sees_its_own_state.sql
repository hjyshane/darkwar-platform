-- The logged-in account's own inventory and levels, from the login response.
--
-- `init` describes ONE account — whichever logged in on the capture machine —
-- and describes it completely: every item stack, every building's level, hero
-- gear and enhancement, vehicle gear. The material planner needs exactly
-- that, and no other command carries it. It also carries the research tree.
-- Parser: normalize/account_state.py.
--
-- PRIVATE BY DESIGN. Every other snapshot table is alliance-readable. This
-- one is readable by the member who claimed the character (user_players)
-- and by admins — not by other members or officers: an inventory is
-- personal, and the planner is the owner's tool. The service key writes it,
-- as it writes everything. `raw` holds only the subset the parser reads —
-- the rest of the login response (linked sign-in names, mail, purchases)
-- never leaves the collector's journal.
--
-- Shape: one row per login, the detail folded into jsonb maps, so a row is an
-- account and never a stack (the PostgREST 1,000-row lesson, 0144/0147).
--   items           {"<itemId>": count}
--   buildings       {"<bId>": level}
--   hero_equips     [{equipId, heroId (null when unworn), level, promote}]
--   hero_intensify  {"<heroId>": level}
--   mod_car_equips  {"<equipId>": level}
--   science         {"<researchId>": level}   (the research tree)
-- Keys are promoted to columns only once the planner reads them by name.

create table public.account_state_snapshots (
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

  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  items jsonb not null default '{}'::jsonb,
  buildings jsonb not null default '{}'::jsonb,
  hero_equips jsonb not null default '[]'::jsonb,
  hero_intensify jsonb not null default '{}'::jsonb,
  mod_car_equips jsonb not null default '{}'::jsonb,
  science jsonb not null default '{}'::jsonb
);

create index account_state_player_captured_idx
  on public.account_state_snapshots (player_id, captured_at desc)
  where player_id is not null;
create index account_state_server_uid_captured_idx
  on public.account_state_snapshots (server_id, game_uid, captured_at desc);

alter table public.account_state_snapshots enable row level security;

revoke all on public.account_state_snapshots from anon;
grant select on public.account_state_snapshots to authenticated;
grant all on public.account_state_snapshots to service_role;

create policy owner_or_admin_read on public.account_state_snapshots
  for select to authenticated
  using (
    (select public.current_app_role()) = 'admin'
    or exists (
      select 1 from public.user_players up
      where up.player_id = account_state_snapshots.player_id
        and up.user_id = (select auth.uid())
    )
  );

-- The newest login per claimed character. security_invoker so the table's
-- owner-or-admin policy is what decides, not the view's owner.
create view public.account_state_latest
with (security_invoker = true) as
select distinct on (s.player_id)
  s.player_id,
  s.server_id,
  s.game_uid,
  s.captured_at,
  s.items,
  s.buildings,
  s.hero_equips,
  s.hero_intensify,
  s.mod_car_equips,
  s.science
from public.account_state_snapshots s
where s.player_id is not null
order by s.player_id, s.captured_at desc;

revoke all on public.account_state_latest from anon;
grant select on public.account_state_latest to authenticated;
grant select on public.account_state_latest to service_role;
