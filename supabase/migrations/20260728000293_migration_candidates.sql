-- 0293: the people we are considering for a move to 580, kept between visits.
--
-- A candidate is only what was typed (a name, or a uid when one is known) plus what we
-- decide about them: which 580 alliance they said they want, and whatever else the
-- officers add as columns. Everything the game tells us - their server, power, tier -
-- is read live from the state lists (0292) at display time, so it is never stored
-- here to go stale.
--
-- Columns are rows too: an officer adds "Notes" or "Contacted" and every candidate gets
-- a cell for it, kept in `extra` under the column's id. Deleting a column leaves the
-- text in `extra` unreferenced; nothing reads it again.
--
-- Officers and admins only (migration.manage, 0186): who wants to leave their server is
-- not the membership's business, and the wish for one of our alliances less so.

create table public.migration_candidates (
  candidate_id uuid primary key default gen_random_uuid(),
  -- As typed: a player name, or the digits of a uid.
  query text not null check (length(btrim(query)) > 0),
  -- Set when the entry is a uid, or an officer pins one of several same-name players.
  game_uid bigint,
  -- The 580 alliance they want to join; null until they say.
  desired_alliance_id uuid references public.alliances (alliance_id) on delete set null,
  -- {column_id: text}
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create unique index migration_candidates_query_idx
  on public.migration_candidates (lower(btrim(query)));

create table public.migration_candidate_columns (
  column_id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create unique index migration_candidate_columns_label_idx
  on public.migration_candidate_columns (lower(btrim(label)));

insert into public.migration_candidate_columns (label, sort_order) values ('Notes', 10);

-- The wished-for alliance must be one of ours. A foreign key cannot say "on server
-- 580", and an alliance of another server in this cell would be a silent mistake.
create function public.migration_candidates_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.desired_alliance_id is not null
     and not exists (select 1 from public.alliances a
                      where a.alliance_id = new.desired_alliance_id and a.server_id = 580) then
    raise exception 'desired alliance must be an alliance of server 580'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger migration_candidates_check
  before insert or update on public.migration_candidates
  for each row execute function public.migration_candidates_check();

alter table public.migration_candidates enable row level security;
alter table public.migration_candidate_columns enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated everything (0207).
revoke all on public.migration_candidates from anon, authenticated;
revoke all on public.migration_candidate_columns from anon, authenticated;
grant select, insert, update, delete on public.migration_candidates to authenticated;
grant select, insert, update, delete on public.migration_candidate_columns to authenticated;
grant all on public.migration_candidates to service_role;
grant all on public.migration_candidate_columns to service_role;

create policy manager_all on public.migration_candidates
  for all to authenticated
  using ((select public.has_permission('migration.manage')))
  with check ((select public.has_permission('migration.manage')));
create policy manager_all on public.migration_candidate_columns
  for all to authenticated
  using ((select public.has_permission('migration.manage')))
  with check ((select public.has_permission('migration.manage')));

comment on table public.migration_candidates is
  'Players being considered for a move to 580 (0293): what was typed, the 580 alliance '
  'they want, and officers'' own columns in extra. Server, power and tier are read live.';
comment on table public.migration_candidate_columns is
  'The extra columns officers add to the candidate table (0293); cells live in '
  'migration_candidates.extra under column_id.';
