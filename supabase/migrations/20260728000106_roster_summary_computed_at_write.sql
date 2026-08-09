-- 0106: the expensive two-thirds of the members table, computed when data
-- arrives instead of every time somebody looks.
--
-- After 0105 the one-query members read costs ~1.2 s on production, and the
-- EXPLAIN says where: ~625 ms computing power growth per member, ~150 ms
-- reducing rank periods, and a spread of per-row RLS checks — all of it
-- READ-TIME computation, repeated for every visit, on figures that only
-- change when the COLLECTOR WRITES. Batches land minutes apart; the screen is
-- opened far more often than that. So the computation moves to the write.
--
-- WHAT IS PRECOMPUTED AND WHAT IS NOT, and why the line sits where it does:
--
--   member_roster_current (table)     live joins in the view
--   ------------------------------    ----------------------------------
--   roster membership + member_rank   players (name, hq, power, kills)
--   growth_1d/7d + timestamps         contributions, presence
--   computed_rank, rank_score         assigned_rank (player_ranks)
--                                     vip / month cards
--
-- The precomputed columns derive ONLY from member-readable sources. That is a
-- security property, not a convenience: refresh runs as whoever triggered the
-- write, and if officer-only figures lived in the table, a member-triggered
-- refresh (a rank rebuild, say) would overwrite them with the nulls RLS shows
-- a member. Subscriptions therefore stay live, behind officer_read RLS and
-- the officer CASE — belt and braces, and 0105 made those probes cheap
-- (primary keys, ~94 rows). assigned_rank stays live so an admin's rank edit
-- shows the moment it is saved, not a drain later.
--
-- REFRESH RUNS INSIDE THE WRITING STATEMENT: statement-level AFTER INSERT
-- triggers on alliance_member_snapshots, player_snapshots and
-- rank_period_snapshots. By the time the write commits — and with it the
-- realtime notification that makes dashboards refetch — the summary is
-- already fresh. There is no staleness window and no scheduler, and the
-- collector needs no changes at all (its PostgREST writes fire the triggers
-- as service_role, whose BYPASSRLS gives the refresh clean plans — the
-- hosted-postgres-does-not-shed-RLS lesson of 0105 does not apply to it).
--
-- Refresh safety, in the order the function checks it:
--   1. an advisory xact lock, tried not taken — concurrent drains skip
--      rather than queue behind each other;
--   2. a caller gate: service requests, members and up, or a direct
--      operator session (no JWT claims at all — psql, migrations);
--   3. the empty guard: the upsert-then-prune shape never replaces a
--      populated table with nothing, because a caller RLS shows an empty
--      roster to (a viewer, a broken session) upserts nothing and then has
--      nothing newer than the stale rows to prune against.
--
-- The migration ends by calling refresh once. If the hosted migration role
-- turns out to see zero roster rows (the ownership question 0105 left open),
-- the empty guard makes that a no-op and the first collector drain fills the
-- table within minutes — the deploy step also fires one service-role refresh
-- immediately, so in practice the gap is seconds.
create table public.member_roster_current (
  player_id uuid primary key references public.players (player_id) on delete cascade,
  member_rank integer,
  computed_rank text,
  rank_score numeric,
  growth_1d numeric,
  growth_7d numeric,
  growth_1d_at timestamptz,
  growth_7d_at timestamptz,
  refreshed_at timestamptz not null default now()
);

alter table public.member_roster_current enable row level security;

create policy member_read on public.member_roster_current
  for select using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );

-- Members and up may WRITE this table too — through refresh_member_roster(),
-- which is what makes a member-triggered rank rebuild leave a fresh summary
-- behind. That is safe precisely because of the design rule above: every
-- stored column derives from member-readable sources, so the most a member's
-- refresh can write is the truth.
create policy member_write_insert on public.member_roster_current
  for insert
  to authenticated with check (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );
create policy member_write_update on public.member_roster_current
  for update
  to authenticated using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );
create policy member_write_delete on public.member_roster_current
  for delete
  to authenticated using (
    current_app_role() = any (array['member','officer','admin']::public.app_role[])
  );

grant select, insert, update, delete on public.member_roster_current to authenticated;
grant all on public.member_roster_current to service_role;

create function public.refresh_member_roster()
returns void
language plpgsql
set search_path = ''
as $$
declare
  -- One timestamp per refresh, taken ONCE. clock_timestamp() advances within
  -- a transaction (so a second refresh in the same transaction outranks the
  -- first — now() would not), but it also advances per ROW if written inline
  -- in the insert, and then the prune below would eat every row except the
  -- literal last one written. Both properties matter; the variable keeps the
  -- first and prevents the second.
  v_ts timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('member_roster_refresh')) then
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
    -- Production carries one own alliance; a dev database can carry several,
    -- because 0031 re-derives is_own from snapshot evidence and resurrects
    -- any it has seen unredacted. Ordering by newest batch makes the pick
    -- deterministic everywhere and means the same thing in both worlds: the
    -- own alliance we most recently observed.
    select x.alliance_id, x.captured_at
    from (
      select a.alliance_id,
             (select max(s.captured_at)
                from public.alliance_member_snapshots s
               where s.alliance_id = a.alliance_id) as captured_at
      from public.alliances a
      where a.is_own
    ) x
    order by x.captured_at desc nulls last
    limit 1
  ),
  roster as (
    select s.player_id, s.member_rank
    from public.alliance_member_snapshots s
    join own_batch b
      on s.alliance_id = b.alliance_id and s.captured_at = b.captured_at
    where s.player_id is not null
  ),
  fresh as (
    select
      r.player_id,
      r.member_rank,
      cr.computed_tier as computed_rank,
      cr.rank_score,
      coalesce(g.growth_1d, rec.growth_since_last) as growth_1d,
      g.growth_7d,
      coalesce(g.power_1d_at, rec.power_prev_at) as growth_1d_at,
      g.power_7d_at as growth_7d_at
    from roster r
    left join lateral (
      -- LIMIT 1 is load-bearing (0103): without it the planner may
      -- de-correlate the lateral and compute the view for every player.
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
    (player_id, member_rank, computed_rank, rank_score,
     growth_1d, growth_7d, growth_1d_at, growth_7d_at, refreshed_at)
  select f.player_id, f.member_rank, f.computed_rank, f.rank_score,
         f.growth_1d, f.growth_7d, f.growth_1d_at, f.growth_7d_at, v_ts
  from fresh f
  on conflict (player_id) do update set
    member_rank  = excluded.member_rank,
    computed_rank = excluded.computed_rank,
    rank_score   = excluded.rank_score,
    growth_1d    = excluded.growth_1d,
    growth_7d    = excluded.growth_7d,
    growth_1d_at = excluded.growth_1d_at,
    growth_7d_at = excluded.growth_7d_at,
    refreshed_at = excluded.refreshed_at;

  -- Members absent from this refresh keep their old refreshed_at and fall
  -- out here. When the refresh upserted nothing, no row carries v_ts and
  -- nothing is pruned — the empty guard.
  if exists (select 1 from public.member_roster_current u
              where u.refreshed_at = v_ts) then
    delete from public.member_roster_current t
    where t.refreshed_at < v_ts;
  end if;
end;
$$;

comment on function public.refresh_member_roster() is
  'Recomputes member_roster_current from the newest own-alliance batch. Runs '
  'inside the writing statement via triggers, so the summary is fresh before '
  'the write''s realtime notification lands. Gated to service requests, '
  'members and up, and operator sessions; an advisory try-lock skips '
  'concurrent refreshes; the upsert-then-prune shape can never empty a '
  'populated table. Only member-readable figures are stored, on purpose — see '
  '0106''s header.';

-- 0095/0096: public alone does not strip platform grants, role names alone
-- do not strip the PUBLIC default. The gate above makes the function safe
-- regardless; the revoke keeps anon out of even a no-op call.
revoke execute on function public.refresh_member_roster() from public, anon;
grant execute on function public.refresh_member_roster() to authenticated, service_role;

create function public.member_roster_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.refresh_member_roster();
  return null;
end;
$$;

create trigger member_roster_refresh
  after insert on public.alliance_member_snapshots
  for each statement execute function public.member_roster_refresh_on_write();
create trigger member_roster_refresh
  after insert on public.player_snapshots
  for each statement execute function public.member_roster_refresh_on_write();
create trigger member_roster_refresh
  after insert on public.rank_period_snapshots
  for each statement execute function public.member_roster_refresh_on_write();

-- The view keeps its name and its 25-column contract, so the frontend does
-- not change. security_invoker now: after 0105 there is no pretending a
-- definer read skips RLS, and at 94 rows the per-row checks cost single-digit
-- milliseconds. RLS on the summary table turns a viewer away; officer_read on
-- vip/month cards nulls those columns for a member with the CASE as the
-- second belt.
create or replace view public.member_roster
with (security_invoker = true) as
select
  t.player_id,
  p.current_name,
  p.hq_level,
  p.power,
  p.kills,
  p.last_seen_at,
  t.member_rank,
  c.daily_donation_score,
  c.weekly_donation_score,
  c.duel_daily_score,
  c.duel_weekly_score,
  c.duel_round_score,
  ar.assigned_rank,
  t.computed_rank,
  t.rank_score,
  t.growth_1d,
  t.growth_7d,
  t.growth_1d_at,
  t.growth_7d_at,
  pr.online_state,
  case
    when pr.online_state is null then null
    when pr.online_state = 'online' then pr.observed_at
    else pr.offline_since
  end as last_online_at,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then mc.expires_at end as month_card_expires_at,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then v.vip_level end as vip_level,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then v.vip_expires_at end as vip_expires_at,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then v.svip_level end as svip_level
from public.member_roster_current t
join public.players p on p.player_id = t.player_id
left join public.player_contributions c on c.player_id = t.player_id
left join public.player_presence pr on pr.player_id = t.player_id
left join public.player_ranks ar on ar.player_id = t.player_id
left join public.player_month_cards mc on mc.player_id = t.player_id
left join public.player_vip v on v.player_id = t.player_id;

comment on view public.member_roster is
  'The members table in one query, now mostly precomputed: membership, growth '
  'and computed rank come from member_roster_current (refreshed inside the '
  'collector''s writing statements, 0106), while names, contributions, '
  'presence, assigned rank and subscriptions stay live — they are primary-key '
  'probes over rows that members may edit or that officers gate. '
  'security_invoker: RLS is the boundary, the officer CASEs are the second '
  'belt. The read-time computation this replaces cost 1.2 s per visit on '
  'production (0105''s floor).';

-- create-or-replace preserves the 0102 grant, but say it anyway: a view that
-- loses its ACL fails closed and loud, and this line is cheaper than the hour.
grant select on public.member_roster to authenticated;

comment on table public.member_roster_current is
  'Precomputed slice of member_roster: roster membership plus the expensive '
  'derived figures (growth, computed rank), all from member-readable sources '
  'ONLY — a member-triggered refresh must never be able to write less than '
  'the truth. Refreshed by statement triggers on the tables that feed it.';

-- Backfill. On the local stack this fills the table; on hosted, if the
-- migration role sees no roster rows the empty guard turns this into a no-op
-- and the deploy step's service-role refresh (or the next drain) fills it.
select public.refresh_member_roster();
