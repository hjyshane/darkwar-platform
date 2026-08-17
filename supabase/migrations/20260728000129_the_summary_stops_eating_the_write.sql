-- 0129: the refresh stops being able to lose a write.
--
-- 0128 scoped the refresh to the alliances a statement touched and that did not
-- help, for a reason the journal makes obvious: one observation carries up to a
-- HUNDRED alliances, because a ranking board is one response. Scoped to the
-- alliances in a board, "incremental" is every alliance there is.
--
-- The cost was never the scope. It was `edges`, which asked for the first and
-- last power reading with a correlated subquery per alliance -- 163 alliances,
-- two subqueries each, every one scanning 43,000 rows. Fourteen million row
-- reads, growing with the square of the history. Rewritten below as two sorts.
--
-- AND THE WRITE STOPS DEPENDING ON IT. However fast the summary gets, it is a
-- summary computed inside the INSERT that produced its input, so the day it is
-- too slow again is the day captures stop reaching the cloud -- silently, with
-- the dashboard showing figures that simply stop moving. That is exactly what
-- 2026-08-13 was. The trigger now runs the refresh with a budget of its own and
-- swallows what happens if it runs out: a stale summary is a number somebody
-- can see is old, and a lost capture is not.
--
-- The 0106/0107/0111 design stands -- compute at write, not per reader. What
-- changes is that the write no longer fails when the computing does.

create or replace function public.refresh_alliance_growth(p_alliance_ids uuid[] default null)
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
  -- TWO SORTS, NOT 326 SCANS. This used to read the first and last power with
  -- a correlated subquery per alliance -- two of them, each scanning the whole
  -- `scoped` CTE. At 163 alliances over 43,000 readings that is about fourteen
  -- million row reads for a figure that needs one pass, and it grows with the
  -- SQUARE of the history: the cost that put alliance writes over the statement
  -- timeout on 2026-08-13 and kept three days of captures out of the cloud.
  --
  -- `distinct on` picks the same row the subquery did -- earliest capture,
  -- highest power on a tie, and the mirror of that for the last -- so the
  -- arithmetic 0081 specified is unchanged. 48_board_scope_test and
  -- 75_incremental_refresh_test both check the figures rather than the plan,
  -- which is what makes a rewrite like this safe to make.
  counts as (
    select alliance_id, count(*) as readings, min(captured_at) as first_at,
           max(captured_at) as last_at
    from scoped
    group by alliance_id
  ),
  first_edge as (
    select distinct on (alliance_id) alliance_id, power as power_first
    from scoped
    order by alliance_id, captured_at, power desc
  ),
  last_edge as (
    select distinct on (alliance_id) alliance_id, power as power_last
    from scoped
    order by alliance_id, captured_at desc, power desc
  ),
  edges as (
    select c.alliance_id, c.first_at, c.last_at, c.readings,
           f.power_first, l.power_last
    from counts c
    join first_edge f on f.alliance_id = c.alliance_id
    join last_edge l on l.alliance_id = c.alliance_id
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


-- ----------------------------------------------------------------- triggers
-- Both wrappers get the same shape: work out what moved, then refresh under a
-- budget, and never let that refresh take the insert down with it.
create or replace function public.alliance_growth_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_prior text := current_setting('statement_timeout', true);
begin
  -- Every alliance in the touched observations, not just the inserted ones:
  -- board scope depends on who else is in the observation, and rows of one
  -- observation need not arrive in one statement (0128, 48_board_scope_test).
  select array_agg(distinct s.alliance_id) into v_ids
  from public.alliance_snapshots s
  where s.observation_id in (select distinct n.observation_id from new_rows n)
    and s.alliance_id is not null;

  begin
    -- A budget well inside whatever the caller has left. Without one, the
    -- refresh spends the statement's whole allowance and the INSERT is what
    -- gets cancelled -- the data, not the summary.
    perform set_config('statement_timeout', '4s', true);
    perform public.refresh_alliance_growth(coalesce(v_ids, array[]::uuid[]));
  exception
    when others then
      -- Deliberately broad. Whatever went wrong computing a summary, the
      -- capture underneath it is still worth keeping, and the next write or a
      -- manual `select public.refresh_alliance_growth()` puts the summary
      -- right. The alternative is what this migration exists to end.
      null;
  end;

  perform set_config('statement_timeout', coalesce(v_prior, '0'), true);
  return null;
end;
$$;

create or replace function public.alliance_latest_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ids text[];
  v_prior text := current_setting('statement_timeout', true);
begin
  select array_agg(distinct n.external_id) into v_ids
  from new_rows n where n.external_id is not null;

  begin
    perform set_config('statement_timeout', '4s', true);
    perform public.refresh_alliance_latest(coalesce(v_ids, array[]::text[]));
  exception
    when others then
      null;
  end;

  perform set_config('statement_timeout', coalesce(v_prior, '0'), true);
  return null;
end;
$$;

-- One rebuild on the new query, so the tables are correct from here forward.
select public.refresh_alliance_growth();
