-- 0156: the member list can say who is under the minimum.
--
-- 0155 works the flag out and stores it on the period snapshot. This carries
-- it the rest of the way: the rank view, the precomputed roster row, and the
-- member list's own view — so a red mark next to a name costs no query.
--
-- IT RIDES ON THE PRECOMPUTED ROW rather than a live join. `player_current_rank`
-- is a DISTINCT ON over every period of every member; joining it per member at
-- read time is precisely the shape 0107 had to undo on the alliance ranking,
-- and today's four timeouts all began that way. `refresh_member_roster` (0106)
-- already reads that view once per refresh, so the flag comes along for free
-- and the read stays a single indexed table.
--
-- The source is member-readable — `rank_period_snapshots` is member/officer/
-- admin (0052) — so 0106's rule about what may live in that table holds: a
-- member-triggered refresh cannot write less than the truth.

-- FIRST, THE VIEW IN BETWEEN. `rank_period_latest` was written as `select *`,
-- but a view's star is expanded once, at creation: the columns 0155 added to
-- the table are not in it, and every reader above it inherits that. Replacing
-- it re-expands the star, which appends the two new columns at the end and
-- leaves the existing contract alone.
--
-- This cost a failed push: 0156 went out asking for `latest.below_minimum` and
-- Postgres said the column does not exist, three views away from the table
-- that has it.
create or replace view public.rank_period_latest
with (security_invoker = true) as
select distinct on (period_start, player_id) *
from public.rank_period_snapshots
order by period_start, player_id, scoring_version desc, computed_at desc;

comment on view public.rank_period_latest is
  'The newest scoring_version per member per period. The screen reads this so '
  'that keeping an old answer does not mean showing it. Re-expanded in 0156 to '
  'pick up 0155''s below_minimum/minimum_missed.';

create or replace view public.player_current_rank
with (security_invoker = true) as
select
  coalesce(latest.player_id, assigned.player_id) as player_id,
  assigned.assigned_rank,
  latest.period_start,
  latest.tier as computed_tier,
  latest.tier_reason as computed_reason,
  latest.activity_score as rank_score,
  latest.donation_pct,
  latest.duel_pct,
  latest.growth_pct,
  -- Appended, so create-or-replace accepts it and every existing reader keeps
  -- the column order it was written against.
  coalesce(latest.below_minimum, false) as below_minimum,
  latest.minimum_missed
from (
  select distinct on (player_id) *
  from public.rank_period_latest
  where period_start + interval '2 weeks' <= now()
  order by player_id, period_start desc
) as latest
full join public.player_ranks as assigned using (player_id);

comment on view public.player_current_rank is
  'What an admin set and what the last FINISHED period worked out, for each '
  'member. A fortnight still running is skipped (0134). Carries 0155''s '
  'below_minimum/minimum_missed so the member list can mark who was under the '
  'alliance floor in the period that is actually in force. security_invoker: '
  'both sides are member-only.';

alter table public.member_roster_current
  add column if not exists below_minimum boolean not null default false;

comment on column public.member_roster_current.below_minimum is
  'From the finished period in force (0155): a weekly donation or duel reading '
  'came in under the alliance minimum. Refreshed with the rest of the row.';

create or replace function public.refresh_member_roster()
returns void
language plpgsql
set search_path = ''
as $$
declare
  -- One timestamp per refresh, taken ONCE (0106).
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
     growth_1d, growth_7d, growth_1d_at, growth_7d_at, refreshed_at)
  select f.player_id, f.member_rank, f.computed_rank, f.rank_score, f.below_minimum,
         f.growth_1d, f.growth_7d, f.growth_1d_at, f.growth_7d_at, v_ts
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
    refreshed_at = excluded.refreshed_at;

  -- The upsert-then-prune shape: nothing carrying v_ts means nothing is
  -- deleted, so an empty read can never empty a populated table (0106).
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
  '0106''s header. Carries 0155''s below_minimum since 0156.';

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
       then v.svip_level end as svip_level,
  -- Appended: create-or-replace only accepts new columns at the end, and every
  -- existing reader keeps the contract it was written against.
  t.below_minimum
from public.member_roster_current t
join public.players p on p.player_id = t.player_id
left join public.player_contributions c on c.player_id = t.player_id
left join public.player_presence pr on pr.player_id = t.player_id
left join public.player_ranks ar on ar.player_id = t.player_id
left join public.player_month_cards mc on mc.player_id = t.player_id
left join public.player_vip v on v.player_id = t.player_id;

comment on view public.member_roster is
  'The members table in one query, mostly precomputed: membership, growth, '
  'computed rank and the 0155 minimum flag come from member_roster_current '
  '(refreshed inside the collector''s writing statements, 0106), while names, '
  'contributions, presence, assigned rank and subscriptions stay live. '
  'security_invoker: RLS is the boundary, the officer CASEs are the second '
  'belt.';

grant select on public.member_roster to authenticated;

-- Replacing the view does not touch rows already in the table (0134's note),
-- so fill the new column now rather than waiting for the next capture.
select public.refresh_member_roster();
