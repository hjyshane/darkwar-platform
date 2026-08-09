-- 0107: the ranking screens stop reading the whole world per visit.
--
-- Same investigation as 0105/0106, pointed at the other three screens. Their
-- diseases are smaller and different from the members table's, so the
-- medicine differs per screen:
--
-- CROSS-SERVER (two indexes). Each board is one filtered read —
-- `source_command = X` over 43k player_snapshots, or `metric = X` over 84k
-- component snapshots — ordered newest-first and limited to 300. Neither
-- filter column had an index, so every board switch was a full scan, a sort
-- of the surviving thousands, and an RLS `current_app_role()` call per row
-- scanned. The composite indexes below match the query's exact order
-- (filter, captured_at desc, rank), so a board becomes ~300 index entries
-- and ~300 role checks.
--
-- ALLIANCE RANKING (the 0106 pattern, lighter). `alliance_latest` was
-- DISTINCT ON over all 22,241 alliance_snapshots rows — every visit read and
-- role-checked the entire history to keep ~160 newest rows. The summary
-- moves into `alliance_latest_current`, refreshed inside the statement that
-- inserts alliance snapshots, exactly as member_roster_current is (0106):
-- same caller gate, same advisory try-lock, same can-never-write-emptiness,
-- same one-clock_timestamp-per-refresh. The view keeps its name and columns,
-- so both readers (Alliance Ranking, Server page) change nothing. The
-- (external_id, captured_at desc) index keeps the refresh itself an index
-- walk as the history grows.
--
-- ARENA is a frontend-only fix (PostgREST embed) and appears in no migration.
create index player_snapshots_command_captured_idx
  on public.player_snapshots (source_command, captured_at desc, rank);

create index player_component_power_metric_captured_idx
  on public.player_component_power_snapshots (metric, captured_at desc, rank);

create index alliance_snapshots_external_captured_idx
  on public.alliance_snapshots (external_id, captured_at desc);

create table public.alliance_latest_current (
  external_id text primary key,
  snapshot_id uuid not null,
  alliance_id uuid,
  server_id integer,
  rank integer,
  name text,
  code text,
  power bigint,
  member_count integer,
  captured_at timestamptz,
  refreshed_at timestamptz not null default now()
);

alter table public.alliance_latest_current enable row level security;

create policy member_read on public.alliance_latest_current
  for select using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );
create policy member_write_insert on public.alliance_latest_current
  for insert
  to authenticated with check (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );
create policy member_write_update on public.alliance_latest_current
  for update
  to authenticated using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );
create policy member_write_delete on public.alliance_latest_current
  for delete
  to authenticated using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );

grant select, insert, update, delete on public.alliance_latest_current to authenticated;
grant all on public.alliance_latest_current to service_role;

create function public.refresh_alliance_latest()
returns void
language plpgsql
set search_path = ''
as $$
declare
  -- One timestamp per refresh, captured once — the same two traps 0106
  -- documents: inline clock_timestamp() advances per row and the prune eats
  -- all but the last; now() freezes per transaction and the prune goes blind.
  v_ts timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('alliance_latest_refresh')) then
    return;
  end if;

  if not (
    public.is_service_request()
    or public.current_app_role() = any (array['member','officer','admin']::public.app_role[])
    or coalesce(current_setting('request.jwt.claims', true), '') = ''
  ) then
    return;
  end if;

  insert into public.alliance_latest_current as t
    (external_id, snapshot_id, alliance_id, server_id, rank, name, code,
     power, member_count, captured_at, refreshed_at)
  select distinct on (s.external_id)
         s.external_id, s.snapshot_id, s.alliance_id, s.server_id, s.rank,
         s.name, s.code, s.power, s.member_count, s.captured_at, v_ts
  from public.alliance_snapshots s
  order by s.external_id, s.captured_at desc
  on conflict (external_id) do update set
    snapshot_id  = excluded.snapshot_id,
    alliance_id  = excluded.alliance_id,
    server_id    = excluded.server_id,
    rank         = excluded.rank,
    name         = excluded.name,
    code         = excluded.code,
    power        = excluded.power,
    member_count = excluded.member_count,
    captured_at  = excluded.captured_at,
    refreshed_at = excluded.refreshed_at;

  if exists (select 1 from public.alliance_latest_current u
              where u.refreshed_at = v_ts) then
    delete from public.alliance_latest_current t
    where t.refreshed_at < v_ts;
  end if;
end;
$$;

comment on function public.refresh_alliance_latest() is
  'Recomputes alliance_latest_current from alliance_snapshots, inside the '
  'statement that writes them. The 0106 contract: caller gate, advisory '
  'try-lock, upsert-then-prune that cannot empty a populated table.';

revoke execute on function public.refresh_alliance_latest() from public, anon;
grant execute on function public.refresh_alliance_latest() to authenticated, service_role;

create function public.alliance_latest_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.refresh_alliance_latest();
  return null;
end;
$$;

create trigger alliance_latest_refresh
  after insert on public.alliance_snapshots
  for each statement execute function public.alliance_latest_refresh_on_write();

-- Same name, same ten columns, ~160 rows instead of 22,241.
create or replace view public.alliance_latest
with (security_invoker = true) as
select snapshot_id, alliance_id, external_id, server_id, rank, name, code,
       power, member_count, captured_at
from public.alliance_latest_current;

comment on view public.alliance_latest is
  'Newest snapshot per alliance, read from the precomputed '
  'alliance_latest_current (0107) instead of a DISTINCT ON over the whole '
  'snapshot history — 22k rows read and role-checked per visit, for ~160 '
  'survivors. Refreshed inside the statements that insert alliance snapshots.';

grant select on public.alliance_latest to authenticated;

-- Backfill; the guards make this a safe no-op wherever the migration role
-- sees nothing, and the deploy step fires one service-role refresh after.
select public.refresh_alliance_latest();
