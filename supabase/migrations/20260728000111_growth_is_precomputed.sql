-- 0111: alliance_growth is read from a precomputed table, not recomputed per visit.
--
-- WHAT BROKE. The Alliance compare tab answered "Could not load the history:
-- canceling statement due to statement timeout" on 2026-08-13, and narrowing the
-- history fetch beside it (#209) did not help because the timeout was the OTHER
-- query: `alliance_growth`. Measured with the service key, which pays NO row
-- level security at all: 2,948 ms for one server's 40 rows. That is the floor,
-- and a member session pays a current_app_role() qual per row on top of it.
--
-- WHY A FILTER COULD NOT SAVE IT. 0081's `scoped` CTE decides each row's board
-- scope with a WINDOW FUNCTION partitioned by observation_id — which is correct
-- (an alliance's rank means something different on a cross-server board) and
-- unpushable: a window is computed before the outer WHERE, so
-- `where server_id = 580` cannot reach under it. Every visit therefore scanned
-- all 42,722 alliance_snapshots rows, partitioned them, grouped them, and then
-- threw away everything but one server. The LATERAL-probe prescription that
-- fixed 0103 and 0110 does not apply for the same reason.
--
-- So this takes the other prescription, the one 0106 and 0107 established: do
-- the work once, in the statement that writes the snapshots, and let the screen
-- read rows. Same machinery as alliance_latest_current, deliberately — caller
-- gate, advisory try-lock, upsert-then-prune that cannot empty a populated
-- table, one clock reading captured per call.
--
-- The view keeps its name and its twenty columns, so the dashboard and the
-- tests that read it do not change.
create table public.alliance_growth_current (
  alliance_id uuid primary key,
  server_id integer,
  name text,
  code text,
  is_own boolean,
  member_count integer,
  readings bigint,
  first_at timestamptz,
  last_at timestamptz,
  power_first bigint,
  power_last bigint,
  power_growth bigint,
  power_growth_pct numeric,
  rank_climb integer,
  rank_first integer,
  rank_last integer,
  span_days double precision,
  cross_rank_first integer,
  cross_rank_last integer,
  cross_rank_climb integer,
  refreshed_at timestamptz not null default now()
);

-- The screen asks for one server at a time.
create index alliance_growth_current_server_idx
  on public.alliance_growth_current (server_id, power_last desc nulls last);

alter table public.alliance_growth_current enable row level security;

-- alliance_snapshots is member_read, and this is derived from it: the same
-- audience, said again here rather than inherited (0097's lesson — a view that
-- forgets is a view that leaks).
create policy member_read on public.alliance_growth_current
  for select using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );
create policy member_write_insert on public.alliance_growth_current
  for insert
  to authenticated with check (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );
create policy member_write_update on public.alliance_growth_current
  for update
  to authenticated using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );
create policy member_write_delete on public.alliance_growth_current
  for delete
  to authenticated using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );

grant select, insert, update, delete on public.alliance_growth_current to authenticated;
grant all on public.alliance_growth_current to service_role;

create function public.refresh_alliance_growth()
returns void
language plpgsql
set search_path = ''
as $$
declare
  -- One timestamp per refresh, captured once — the two traps 0106 documents:
  -- inline clock_timestamp() advances per row and the prune eats all but the
  -- last; now() freezes per transaction and the prune goes blind.
  v_ts timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('alliance_growth_refresh')) then
    return;
  end if;

  if not (
    public.is_service_request()
    or public.current_app_role() = any (array['member','officer','admin']::public.app_role[])
    or coalesce(current_setting('request.jwt.claims', true), '') = ''
  ) then
    return;
  end if;

  insert into public.alliance_growth_current as t (
    alliance_id, server_id, name, code, is_own, member_count, readings,
    first_at, last_at, power_first, power_last, power_growth, power_growth_pct,
    rank_climb, rank_first, rank_last, span_days,
    cross_rank_first, cross_rank_last, cross_rank_climb, refreshed_at)
  -- 0081's arithmetic, unchanged. It runs once per write batch here instead of
  -- once per reader, which is the whole change.
  with scoped as (
    select
      s.alliance_id,
      s.captured_at,
      s.power,
      s.rank,
      case
        when min(s.server_id) over (partition by s.observation_id)
           <> max(s.server_id) over (partition by s.observation_id)
          then 'cross_server'
        else 'server'
      end as board_scope
    from public.alliance_snapshots s
    where s.power is not null
  ),
  bounds as (
    select
      alliance_id,
      min(captured_at) as first_at,
      max(captured_at) as last_at,
      count(*) as readings
    from scoped
    group by alliance_id
  ),
  edges as (
    select
      b.alliance_id,
      b.first_at,
      b.last_at,
      b.readings,
      (select s.power from scoped s
        where s.alliance_id = b.alliance_id and s.captured_at = b.first_at
        order by s.power desc limit 1) as power_first,
      (select s.power from scoped s
        where s.alliance_id = b.alliance_id and s.captured_at = b.last_at
        order by s.power desc limit 1) as power_last
    from bounds b
  ),
  -- One row per alliance per board, so an edge can never pair a server rank
  -- with a cross-server one.
  rank_edges as (
    select
      alliance_id,
      board_scope,
      count(*) as readings,
      (array_agg(rank order by captured_at, power desc))[1] as rank_first,
      (array_agg(rank order by captured_at desc, power desc))[1] as rank_last
    from scoped
    where rank is not null
    group by alliance_id, board_scope
  )
  select
    e.alliance_id,
    a.server_id,
    a.current_name,
    a.current_code,
    a.is_own,
    a.member_count,
    e.readings,
    e.first_at,
    e.last_at,
    e.power_first,
    e.power_last,
    case when e.readings > 1 then e.power_last - e.power_first end,
    case
      when e.readings > 1 and e.power_first > 0
        then round(((e.power_last - e.power_first)::numeric / e.power_first) * 100, 2)
    end,
    case when sv.readings > 1 then sv.rank_first - sv.rank_last end,
    sv.rank_first,
    sv.rank_last,
    extract(epoch from (e.last_at - e.first_at)) / 86400.0,
    cs.rank_first,
    cs.rank_last,
    case when cs.readings > 1 then cs.rank_first - cs.rank_last end,
    v_ts
  from edges e
  join public.alliances a on a.alliance_id = e.alliance_id
  left join rank_edges sv
    on sv.alliance_id = e.alliance_id and sv.board_scope = 'server'
  left join rank_edges cs
    on cs.alliance_id = e.alliance_id and cs.board_scope = 'cross_server'
  on conflict (alliance_id) do update set
    server_id        = excluded.server_id,
    name             = excluded.name,
    code             = excluded.code,
    is_own           = excluded.is_own,
    member_count     = excluded.member_count,
    readings         = excluded.readings,
    first_at         = excluded.first_at,
    last_at          = excluded.last_at,
    power_first      = excluded.power_first,
    power_last       = excluded.power_last,
    power_growth     = excluded.power_growth,
    power_growth_pct = excluded.power_growth_pct,
    rank_climb       = excluded.rank_climb,
    rank_first       = excluded.rank_first,
    rank_last        = excluded.rank_last,
    span_days        = excluded.span_days,
    cross_rank_first = excluded.cross_rank_first,
    cross_rank_last  = excluded.cross_rank_last,
    cross_rank_climb = excluded.cross_rank_climb,
    refreshed_at     = excluded.refreshed_at;

  -- An alliance that has left every board keeps no stale row — but a refresh
  -- that wrote nothing (a caller who can see no snapshots) must never empty a
  -- populated table.
  if exists (select 1 from public.alliance_growth_current u
              where u.refreshed_at = v_ts) then
    delete from public.alliance_growth_current t
    where t.refreshed_at < v_ts;
  end if;
end;
$$;

comment on function public.refresh_alliance_growth() is
  'Recomputes alliance_growth_current from alliance_snapshots, inside the '
  'statement that writes them. The 0106 contract: caller gate, advisory '
  'try-lock, upsert-then-prune that cannot empty a populated table.';

revoke execute on function public.refresh_alliance_growth() from public, anon;
grant execute on function public.refresh_alliance_growth() to authenticated, service_role;

create function public.alliance_growth_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.refresh_alliance_growth();
  return null;
end;
$$;

create trigger alliance_growth_refresh
  after insert on public.alliance_snapshots
  for each statement execute function public.alliance_growth_refresh_on_write();

-- Same name, same twenty columns, one row per alliance. Dropped and recreated
-- rather than replaced because the source changes from a CTE stack to a table;
-- the grant goes back on straight after, which is the thing 0086 forgot once.
drop view public.alliance_growth;

create view public.alliance_growth
with (security_invoker = true) as
select alliance_id, server_id, name, code, is_own, member_count, readings,
       first_at, last_at, power_first, power_last, power_growth,
       power_growth_pct, rank_climb, rank_first, rank_last, span_days,
       cross_rank_first, cross_rank_last, cross_rank_climb
from public.alliance_growth_current;

comment on view public.alliance_growth is
  'Power and rank movement per alliance, read from the precomputed '
  'alliance_growth_current (0111). Rank edges are taken within ONE board: '
  'rank_climb/rank_first/rank_last are the server board, cross_rank_* are the '
  'cross-server board. The arithmetic is 0081''s; what changed is that it runs '
  'when snapshots are written rather than on every visit — the window function '
  'over observation_id cannot be pushed under a server filter, so each visit '
  'was scanning all 42k snapshot rows for one server''s 40.';

grant select on public.alliance_growth to authenticated;

-- Backfill. The guards make this a safe no-op wherever the migration role
-- cannot see snapshots; on a linked project it runs as the owner and fills the
-- table, so the first reader after deploy does not meet an empty screen.
select public.refresh_alliance_growth();
