-- 0228: a player_snapshots insert refreshes only the members it names.
--
-- member_roster_refresh (0106) ran refresh_member_roster() — the whole members
-- table: every own alliance's newest roster, growth and computed rank for all
-- 165 members, every row rewritten — once per insert statement into
-- player_snapshots. On prod (2026-10-04) 10,523 such inserts averaged 538 ms
-- and peaked at 8.0 s, the hosted statement_timeout; sync had to halve a
-- 304-row batch three times to get it in. The read alone is ~0.3 s; the rest
-- is rewriting 165 rows that, for this table, almost never change.
--
-- player_snapshots is mostly OTHER players: server and kill rankings cover all
-- eight servers, so of the newest 5,000 rows only 28% were members. What a
-- player snapshot can move on the members table is that member's own growth
-- (power history) and computed rank — never membership, which comes from
-- alliance_member_snapshots and keeps its full refresh there.
--
-- So this table's trigger now takes the members among the rows it wrote,
-- returns at once when there are none, and otherwise recomputes just those
-- rows with the full refresh's own query, writing only rows whose figures
-- moved. Rows it leaves alone keep their refreshed_at; only a full refresh
-- prunes, and it rewrites every row first.

create function public.refresh_member_roster_players(p_players uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ts timestamptz := clock_timestamp();
begin
  if p_players is null or cardinality(p_players) = 0 then
    return;
  end if;

  if not (
    public.is_service_request()
    or public.current_app_role() = any (array['member','officer','admin']::public.app_role[])
    or coalesce(current_setting('request.jwt.claims', true), '') = ''
  ) then
    return;
  end if;

  with own_batch as (
    select a.alliance_id,
           (select max(s.captured_at)
              from public.alliance_member_snapshots s
             where s.alliance_id = a.alliance_id) as captured_at
    from public.alliances a
    where a.is_own
  ),
  -- A player who moved between our alliances is in both newest batches
  -- until the old one is recaptured. One row per player, the newer batch
  -- winning: without this the upsert below touches a row twice and fails.
  roster as (
    select distinct on (s.player_id) s.player_id, s.member_rank, s.alliance_id
    from public.alliance_member_snapshots s
    join own_batch b
      on s.alliance_id = b.alliance_id and s.captured_at = b.captured_at
    where s.player_id = any (p_players)
    order by s.player_id, s.captured_at desc
  ),
  fresh as (
    select
      r.player_id,
      r.member_rank,
      r.alliance_id,
      cr.computed_tier as computed_rank,
      cr.rank_score,
      coalesce(cr.below_minimum, false) as below_minimum,
      coalesce(g.growth_1d, rec.growth_since_last) as growth_1d,
      g.growth_7d,
      coalesce(g.power_1d_at, rec.power_prev_at) as growth_1d_at,
      g.power_7d_at as growth_7d_at
    from roster r
    left join lateral (
      -- LIMIT 1 is load-bearing (0103).
      select g0.growth_1d, g0.growth_7d, g0.power_1d_at, g0.power_7d_at
      from public.player_power_growth g0
      where g0.player_id = r.player_id
      limit 1
    ) g on true
    left join lateral (
      select r0.growth_since_last, r0.power_prev_at
      from public.player_growth_recent r0
      where r0.player_id = r.player_id
      limit 1
    ) rec on true
    left join public.player_current_rank cr on cr.player_id = r.player_id
  )
  insert into public.member_roster_current as t
    (player_id, member_rank, computed_rank, rank_score, below_minimum,
     growth_1d, growth_7d, growth_1d_at, growth_7d_at, refreshed_at, alliance_id)
  select f.player_id, f.member_rank, f.computed_rank, f.rank_score, f.below_minimum,
         f.growth_1d, f.growth_7d, f.growth_1d_at, f.growth_7d_at, v_ts, f.alliance_id
  from fresh f
  on conflict (player_id) do update set
    member_rank  = excluded.member_rank,
    computed_rank = excluded.computed_rank,
    rank_score   = excluded.rank_score,
    below_minimum = excluded.below_minimum,
    growth_1d    = excluded.growth_1d,
    growth_7d    = excluded.growth_7d,
    growth_1d_at = excluded.growth_1d_at,
    growth_7d_at = excluded.growth_7d_at,
    refreshed_at = excluded.refreshed_at,
    alliance_id  = excluded.alliance_id
  -- A row whose figures did not move is left alone: most refreshes here
  -- change nothing, and rewriting 165 rows per insert was the cost.
  where (t.member_rank, t.computed_rank, t.rank_score, t.below_minimum, t.growth_1d,
         t.growth_7d, t.growth_1d_at, t.growth_7d_at, t.alliance_id)
        is distinct from
        (excluded.member_rank, excluded.computed_rank, excluded.rank_score,
         excluded.below_minimum, excluded.growth_1d, excluded.growth_7d,
         excluded.growth_1d_at, excluded.growth_7d_at, excluded.alliance_id);

end;
$$;

comment on function public.refresh_member_roster_players(uuid[]) is
  'refresh_member_roster (0196) for the named players only, writing only rows '
  'whose figures changed. Called by the player_snapshots statement trigger with '
  'the members among the rows it wrote (0228).';

revoke all on function public.refresh_member_roster_players(uuid[]) from public, anon;
grant execute on function public.refresh_member_roster_players(uuid[])
  to authenticated, service_role;

create function public.member_roster_refresh_players_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_players uuid[];
begin
  select array_agg(distinct n.player_id)
    into v_players
    from new_rows n
    join public.member_roster_current c on c.player_id = n.player_id;

  -- No member in the batch: nothing on the members table can have moved.
  if v_players is null then
    return null;
  end if;

  perform public.refresh_member_roster_players(v_players);
  return null;
end;
$$;

revoke all on function public.member_roster_refresh_players_on_write() from public, anon;

drop trigger member_roster_refresh on public.player_snapshots;
create trigger member_roster_refresh
  after insert on public.player_snapshots
  referencing new table as new_rows
  for each statement execute function public.member_roster_refresh_players_on_write();
