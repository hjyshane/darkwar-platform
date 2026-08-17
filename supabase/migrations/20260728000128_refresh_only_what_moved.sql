-- 0128: the write path stops rebuilding the world on every insert.
--
-- WHAT BROKE, exactly. 0107 and 0111 moved two expensive read-time queries to
-- write time — the right call, and the reason both files exist. But "once per
-- write batch" was implemented as a FULL REBUILD: each recomputes itself from
-- every row of `alliance_snapshots`, inside the INSERT statement, behind an
-- after-insert statement trigger.
--
-- On 2026-08-13 that crossed the statement timeout. Every alliance batch since
-- has come back
--
--   57014: canceling statement due to statement timeout
--
-- and, after its retries, become a dead letter. 11,592 of them. The table has
-- been frozen at 43,343 rows since that morning and
-- `alliance_growth_current.refreshed_at` still reads 2026-08-13T03:14:21Z —
-- the collector kept capturing, the journal kept growing, and nothing reached
-- the cloud. The alliance page's "last seen" and the cross-server alliance
-- board have both been three days stale ever since, and readers saw the
-- growth section time out at random: every five minutes sync retried, and each
-- retry spent the instance on two full scans that were never going to finish.
--
-- So: refresh only what the statement actually touched.
--
-- THE PRUNE IS THE TRAP. Both functions end with "delete every row this
-- refresh did not rewrite", which is correct for a full rebuild and catastrophic
-- for a partial one — a batch touching four alliances would delete the other
-- 159. The prune now runs only when the refresh was asked for everything, and
-- the argument that says so is the same argument that scopes the scan.

-- `observation_id` had no index, and the growth query groups by it to decide
-- whether a reading came from a server board or a cross-server one. Without
-- this the scoped version would still read the whole table to answer that.
create index if not exists alliance_snapshots_observation_idx
  on public.alliance_snapshots (observation_id);

-- Dropped rather than replaced: adding a defaulted parameter creates an
-- overload, and `refresh_alliance_growth()` would then be ambiguous between
-- the old zero-argument function and the new one's default.
drop trigger if exists alliance_growth_refresh on public.alliance_snapshots;
drop trigger if exists alliance_latest_refresh on public.alliance_snapshots;
drop function if exists public.alliance_growth_refresh_on_write();
drop function if exists public.alliance_latest_refresh_on_write();
drop function if exists public.refresh_alliance_growth();
drop function if exists public.refresh_alliance_latest();

-- ------------------------------------------------------------------- growth
create function public.refresh_alliance_growth(p_alliance_ids uuid[] default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  -- One timestamp per refresh, captured once — the two traps 0106 documents:
  -- inline clock_timestamp() advances per row and the prune eats all but the
  -- last; now() freezes per transaction and the prune goes blind.
  v_ts timestamptz := clock_timestamp();
  v_all boolean := p_alliance_ids is null;
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

  -- An empty array is "nothing moved", which is not the same as "rebuild
  -- everything". Without this a batch that inserted only null-alliance rows
  -- would fall through to a full rebuild — the exact cost this migration exists
  -- to remove.
  if not v_all and coalesce(array_length(p_alliance_ids, 1), 0) = 0 then
    return;
  end if;

  insert into public.alliance_growth_current as t (
    alliance_id, server_id, name, code, is_own, member_count, readings,
    first_at, last_at, power_first, power_last, power_growth, power_growth_pct,
    rank_climb, rank_first, rank_last, span_days,
    cross_rank_first, cross_rank_last, cross_rank_climb, refreshed_at)
  -- 0081's arithmetic, unchanged in what it computes. The only difference is
  -- how much of the table it reads to compute it.
  with touched as (
    -- The observations that carry a reading for an alliance in scope. Board
    -- scope is a property of the OBSERVATION, not of the row: a reading counts
    -- as cross-server when the response it arrived in spanned more than one
    -- server. Filtering by alliance alone would hide the sibling rows that make
    -- that true, and every cross-server reading would silently become a server
    -- one — the ranks on the alliance growth board would still be numbers, and
    -- they would be the wrong numbers.
    select distinct s.observation_id
    from public.alliance_snapshots s
    where s.power is not null
      and (v_all or s.alliance_id = any (p_alliance_ids))
  ),
  obs_scope as (
    -- `power is not null` HERE as well, and it is not tidiness. The original
    -- computed the scope as a window function over the rows that survived that
    -- filter, so an observation whose only other server carried a null power
    -- counts as a server board. Grouping over the unfiltered table instead
    -- silently reclassifies those readings, which 48_board_scope_test catches
    -- and which would otherwise have shipped as ranks that are still numbers
    -- and no longer the right ones.
    select
      s.observation_id,
      case when min(s.server_id) <> max(s.server_id) then 'cross_server' else 'server' end
        as board_scope
    from public.alliance_snapshots s
    join touched t on t.observation_id = s.observation_id
    where s.power is not null
    group by s.observation_id
  ),
  scoped as (
    select s.alliance_id, s.captured_at, s.power, s.rank, o.board_scope
    from public.alliance_snapshots s
    join obs_scope o on o.observation_id = s.observation_id
    where s.power is not null
      and (v_all or s.alliance_id = any (p_alliance_ids))
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

  -- ONLY ON A FULL REFRESH. "Delete every row this pass did not rewrite" means
  -- "an alliance that has left every board keeps no stale row" when the pass
  -- saw every board, and means "delete the 159 alliances this batch did not
  -- mention" when it did not. The guard against emptying a populated table
  -- (0106) stays exactly as it was.
  if v_all and exists (select 1 from public.alliance_growth_current u
                        where u.refreshed_at = v_ts) then
    delete from public.alliance_growth_current t
    where t.refreshed_at < v_ts;
  end if;
end;
$$;

comment on function public.refresh_alliance_growth(uuid[]) is
  'Recomputes alliance_growth_current. Given alliance ids it recomputes only '
  'those and prunes nothing; given null it rebuilds everything and prunes as '
  'before. The 0106 contract otherwise: caller gate, advisory try-lock, '
  'upsert-then-prune that cannot empty a populated table.';

revoke execute on function public.refresh_alliance_growth(uuid[]) from public, anon;
grant execute on function public.refresh_alliance_growth(uuid[]) to authenticated, service_role;

-- ------------------------------------------------------------------- latest
create function public.refresh_alliance_latest(p_external_ids text[] default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ts timestamptz := clock_timestamp();
  v_all boolean := p_external_ids is null;
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

  if not v_all and coalesce(array_length(p_external_ids, 1), 0) = 0 then
    return;
  end if;

  insert into public.alliance_latest_current as t
    (external_id, snapshot_id, alliance_id, server_id, rank, name, code,
     power, member_count, captured_at, refreshed_at)
  select distinct on (s.external_id)
         s.external_id, s.snapshot_id, s.alliance_id, s.server_id, s.rank,
         s.name, s.code, s.power, s.member_count, s.captured_at, v_ts
  from public.alliance_snapshots s
  where v_all or s.external_id = any (p_external_ids)
  -- The index 0107 added is (external_id, captured_at desc), which is exactly
  -- what this DISTINCT ON wants — scoped, it now reads a handful of entries
  -- per alliance instead of every row in the table.
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

  if v_all and exists (select 1 from public.alliance_latest_current u
                        where u.refreshed_at = v_ts) then
    delete from public.alliance_latest_current t
    where t.refreshed_at < v_ts;
  end if;
end;
$$;

comment on function public.refresh_alliance_latest(text[]) is
  'Recomputes alliance_latest_current. Given external ids it recomputes only '
  'those and prunes nothing; given null it rebuilds everything and prunes as '
  'before.';

revoke execute on function public.refresh_alliance_latest(text[]) from public, anon;
grant execute on function public.refresh_alliance_latest(text[]) to authenticated, service_role;

-- ----------------------------------------------------------------- triggers
-- `referencing new table` is new here. Both triggers had it available and
-- neither used it, which is how a per-batch refresh became a per-batch rebuild.
create function public.alliance_growth_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- EVERY ALLIANCE IN THE TOUCHED OBSERVATIONS, not just the ones this
  -- statement inserted. Board scope is decided by who else appears in the same
  -- observation, so a reading's classification can change when a SIBLING row
  -- arrives — and rows of one observation do not have to arrive in one
  -- statement.
  --
  -- 48_board_scope_test found this the hard way. Insert our alliance's
  -- cross-server row on its own and the observation holds one server at that
  -- instant: the reading is filed as a server board reading, correctly for what
  -- is known. Insert the 581 alliance a moment later and the observation is now
  -- cross-server — but a refresh scoped to the second alliance never revisits
  -- the first, so it keeps the wrong scope forever. The old full rebuild hid
  -- this by recomputing the world every time.
  --
  -- Widening to the observation costs nothing in the normal case, where sync
  -- writes a whole board in one batch and this is the same set.
  select array_agg(distinct s.alliance_id) into v_ids
  from public.alliance_snapshots s
  where s.observation_id in (select distinct n.observation_id from new_rows n)
    and s.alliance_id is not null;
  perform public.refresh_alliance_growth(coalesce(v_ids, array[]::uuid[]));
  return null;
end;
$$;

create trigger alliance_growth_refresh
  after insert on public.alliance_snapshots
  referencing new table as new_rows
  for each statement execute function public.alliance_growth_refresh_on_write();

create function public.alliance_latest_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids text[];
begin
  select array_agg(distinct n.external_id) into v_ids
  from new_rows n where n.external_id is not null;
  perform public.refresh_alliance_latest(coalesce(v_ids, array[]::text[]));
  return null;
end;
$$;

create trigger alliance_latest_refresh
  after insert on public.alliance_snapshots
  referencing new table as new_rows
  for each statement execute function public.alliance_latest_refresh_on_write();

-- One full rebuild now, so the two tables are correct from this migration
-- forward regardless of what the incremental path does next. This is the one
-- expensive run, and it happens here rather than inside somebody's insert.
select public.refresh_alliance_growth();
select public.refresh_alliance_latest();
