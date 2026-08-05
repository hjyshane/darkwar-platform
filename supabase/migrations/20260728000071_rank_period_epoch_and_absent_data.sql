-- 0071: the grid moves to 2026-08-03, and absent data stops being scored as
-- zero.
--
-- Found by making the period selectable (#109). The admin screen had only ever
-- reported on the newest CLOSED period, which on the old grid is 2026-07-13 —
-- before this collector existed. Building it produced 95 rows, 93 of them
-- graded R3 with `tier_reason = 'score'`, from a fortnight containing no
-- captures at all.
--
-- Three separate defects, all visible in one row:
--
--   donation=0  duel=0  growth=NULL  activity=0  offline_h=-225.4  tier=R3
--
-- 1. ZERO STANDING IN FOR ABSENT. `power_growth` correctly returned null, but
--    donation and duel were `coalesce(..., 0)`. Zero is a statement about a
--    person — they contributed nothing — and it was being made about a
--    fortnight nobody observed. FR-UI-008 forbids exactly this, and it was
--    happening at the source rather than in a component.
--
-- 2. PRESENCE READ FROM OUTSIDE THE PERIOD. The `presence` CTE had no window
--    filter at all: it took the newest presence row whenever it was observed,
--    then computed `period_end - offline_since`. For any period that has
--    already closed, presence is newer than the period, so the answer is
--    NEGATIVE. -225 hours. That formula only ever made sense for the period in
--    progress.
--
-- 3. A TIER ASSIGNED ANYWAY. With every input absent, the percentile machinery
--    still ranked 95 identical rows and cut them into tiers. "R3, because
--    score" is a judgement, and there was nothing to judge.
--
-- WHY THE EPOCH MOVES. 2026-07-27 was chosen because the game named it: arena
-- reported it as its own `week_start` in a real capture. 2026-08-03 is equally
-- a Monday 02:00 UTC boundary — confirmed against the same arena data, whose
-- weeks also start on Monday — so this is not a change to the RULE. A
-- fortnightly grid has two possible phases and both are valid; the operator
-- picked the one that starts this week, so periods now run 08-03 → 08-17 and
-- every other Monday from there.
--
-- Old rows are left alone. `2026-07-13` is no longer a grid start, so nothing
-- reaches them, and CLAUDE.md's rule is that historical scores are not
-- overwritten. `scoring_version` is added so a future change to the formula
-- can sit beside its predecessor instead of replacing it.

-- ---------------------------------------------------------------------------
-- The grid.
create or replace function public.rank_period_start(ts timestamptz)
returns timestamptz
language sql
immutable
as $$
  -- Floor to an even number of game weeks from the epoch. The double modulo is
  -- deliberate: a date before the epoch makes the single one negative and the
  -- grid has to hold on both sides of it.
  select timestamptz '2026-08-03 02:00:00+00'
    + (
        (
          floor(
            extract(epoch from (
              public.reset_week_start(ts) - timestamptz '2026-08-03 02:00:00+00'
            )) / 604800
          )::bigint
          - ((floor(
              extract(epoch from (
                public.reset_week_start(ts) - timestamptz '2026-08-03 02:00:00+00'
              )) / 604800
            )::bigint % 2) + 2) % 2
        ) * interval '1 week'
      );
$$;

comment on function public.rank_period_start(timestamptz) is
  'The two-week rank period containing ts, anchored at 2026-08-03 02:00 UTC. '
  'Both that and the previous anchor are real Monday 02:00 boundaries — a '
  'fortnightly grid has two phases and this is the one the alliance uses. '
  'Checked against protocol-fixtures/rank-period/vectors.json alongside '
  'apps/dashboard/src/lib/rankPeriod.ts.';

-- ---------------------------------------------------------------------------
-- Room for more than one answer per period.
alter table public.rank_period_snapshots
  add column if not exists scoring_version int not null default 1;

comment on column public.rank_period_snapshots.scoring_version is
  'Which version of the scoring rules produced this row. 1 is everything '
  'built before 0071, including rows that scored absent data as zero. A '
  'formula change bumps this rather than rewriting what somebody was already '
  'judged by.';

alter table public.rank_period_snapshots
  drop constraint if exists rank_period_snapshots_period_start_player_id_key;
alter table public.rank_period_snapshots
  add constraint rank_period_snapshots_period_player_version_key
  unique (period_start, player_id, scoring_version);

-- What the screen should read: the newest answer for each member of a period.
create view public.rank_period_latest
with (security_invoker = true) as
select distinct on (period_start, player_id) *
from public.rank_period_snapshots
order by period_start, player_id, scoring_version desc, computed_at desc;

comment on view public.rank_period_latest is
  'The newest scoring_version per member per period. The screen reads this so '
  'that keeping an old answer does not mean showing it.';

grant select on public.rank_period_latest to authenticated;

-- ---------------------------------------------------------------------------
-- Scoring version 2.
create or replace function public.build_rank_period(p_period_start timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written integer;
  week_ends timestamptz[] := public.rank_period_week_ends(p_period_start);
  period_end timestamptz := p_period_start + interval '14 days';
  settings jsonb;
  w_donation numeric;
  w_duel numeric;
  w_growth numeric;
  w_total numeric;
  offline_cut numeric;
  r3 numeric;
  r2 numeric;
begin
  if public.current_app_role() not in ('member', 'officer', 'admin') then
    raise exception 'members only' using errcode = '42501';
  end if;

  select value into settings from public.app_settings where key = 'rank_tiers';
  w_donation := coalesce((settings -> 'weights' ->> 'donation')::numeric, 0);
  w_duel := coalesce((settings -> 'weights' ->> 'duel')::numeric, 0);
  w_growth := coalesce((settings -> 'weights' ->> 'power_growth')::numeric, 0);
  w_total := nullif(w_donation + w_duel + w_growth, 0);
  offline_cut := coalesce((settings ->> 'offline_hours')::numeric, 48);
  r3 := coalesce((settings ->> 'r3_percent')::numeric, 20);
  r2 := coalesce((settings ->> 'r2_percent')::numeric, 50);

  with own_alliance as (
    select a.alliance_id from public.alliances a where a.is_own limit 1
  ),
  -- When we FIRST saw each member in our own roster, and when we first saw the
  -- roster at all.
  --
  -- The protocol carries no join date. al.rank's member entries hold rank,
  -- power, kills, offline time and a month-card expiry, and nothing that says
  -- when somebody joined — checked against a real capture rather than assumed.
  -- So "joined recently" is approximated by "first appeared in a roster capture
  -- of ours".
  --
  -- The second column is what keeps that approximation honest. This collector
  -- is days old, so every member's first sighting is recent, and a naive rule
  -- would call the entire alliance new and grade nobody. Somebody whose first
  -- sighting IS our first sighting of the roster was already there; we simply
  -- do not know for how long. Only an appearance after that is a join we
  -- actually witnessed.
  roster_start as (
    select min(s.captured_at) as roster_first_seen
    from public.alliance_member_snapshots s
    join own_alliance o on o.alliance_id = s.alliance_id
  ),
  seen as (
    select s.player_id, min(s.captured_at) as first_seen
    from public.alliance_member_snapshots s
    join own_alliance o on o.alliance_id = s.alliance_id
    where s.player_id is not null
    group by s.player_id
  ),
  -- The member rank the game itself reports (al.rank's `rank`: 5 is leader,
  -- 4 the leader's officers, 3 warriors, 2 soldiers). Taken as of the period's
  -- end rather than now, so a promotion after the period does not change how
  -- the period was scored.
  ranks_at_end as (
    select distinct on (s.player_id) s.player_id, s.member_rank
    from public.alliance_member_snapshots s
    join own_alliance o on o.alliance_id = s.alliance_id
    where s.player_id is not null and s.captured_at <= period_end
    order by s.player_id, s.captured_at desc
  ),
  members as (
    select p.player_id, p.game_uid, p.current_name,
      mr.member_rank,
      sn.first_seen,
      rs.roster_first_seen
    from public.players p
    join public.alliances a on a.alliance_id = p.current_alliance_id
    left join ranks_at_end mr on mr.player_id = p.player_id
    left join seen sn on sn.player_id = p.player_id
    cross join roster_start rs
    where a.is_own
  ),
  reading as (
    select m.player_id, w.idx, t.kind, c.score, c.captured_at
    from members m
    cross join lateral (values
      (1, p_period_start, week_ends[1]),
      (2, week_ends[1], week_ends[2])
    ) as w(idx, opens, closes)
    cross join lateral (values ('weekly_donation'), ('alliance_battle_weekly')) as t(kind)
    cross join lateral (
      select s.score, s.captured_at
      from public.alliance_contribution_snapshots s
      where s.game_uid = m.game_uid
        and s.contribution_type = t.kind
        and s.captured_at > w.opens
        and s.captured_at <= w.closes
      order by s.captured_at desc
      limit 1
    ) c
  ),
  contribution as (
    select
      player_id,
      max(score) filter (where kind = 'weekly_donation' and idx = 1) as donation_week1,
      max(captured_at) filter (where kind = 'weekly_donation' and idx = 1) as donation_week1_at,
      max(score) filter (where kind = 'weekly_donation' and idx = 2) as donation_week2,
      max(captured_at) filter (where kind = 'weekly_donation' and idx = 2) as donation_week2_at,
      max(score) filter (where kind = 'alliance_battle_weekly' and idx = 1) as duel_week1,
      max(captured_at) filter (where kind = 'alliance_battle_weekly' and idx = 1) as duel_week1_at,
      max(score) filter (where kind = 'alliance_battle_weekly' and idx = 2) as duel_week2,
      max(captured_at) filter (where kind = 'alliance_battle_weekly' and idx = 2) as duel_week2_at
    from reading
    group by player_id
  ),
  power_at_start as (
    select distinct on (m.player_id) m.player_id, s.power, s.captured_at
    from members m
    join public.player_snapshots s on s.player_id = m.player_id
    where s.power is not null and s.captured_at <= p_period_start
    order by m.player_id, s.captured_at desc
  ),
  power_at_end as (
    select distinct on (m.player_id) m.player_id, s.power, s.captured_at
    from members m
    join public.player_snapshots s on s.player_id = m.player_id
    where s.power is not null
      and s.captured_at <= period_end
      and s.captured_at > p_period_start
    order by m.player_id, s.captured_at desc
  ),
  presence as (
    -- BOUNDED BY THE PERIOD. Without `observed_at <= period_end` this took the
    -- newest presence row whenever it happened to be observed, and for a period
    -- that has already closed that is always later than the period — which made
    -- `period_end - offline_since` negative. Real values of -225 and -236 hours
    -- were written and fed into the activity score.
    select distinct on (m.player_id) m.player_id, pr.online_state, pr.offline_since
    from members m
    join public.player_presence pr on pr.player_id = m.player_id
    where pr.observed_at <= period_end
    order by m.player_id, pr.observed_at desc
  ),
  figures as (
    select
      m.player_id, m.game_uid, m.current_name,
      -- Carried through so `gradable` below can see who is out of the pool.
      m.member_rank, m.first_seen, m.roster_first_seen,
      c.donation_week1, c.donation_week1_at, c.donation_week2, c.donation_week2_at,
      c.duel_week1, c.duel_week1_at, c.duel_week2, c.duel_week2_at,
      -- Null when NEITHER week was read, the sum of what exists otherwise.
      -- "Nobody looked" and "they donated nothing" are different facts, and the
      -- weekly columns beside this say which of the two readings is missing.
      case when c.donation_week1 is null and c.donation_week2 is null then null
           else coalesce(c.donation_week1, 0) + coalesce(c.donation_week2, 0) end
        as donation_total,
      case when c.duel_week1 is null and c.duel_week2 is null then null
           else coalesce(c.duel_week1, 0) + coalesce(c.duel_week2, 0) end
        as duel_total,
      ps.power as power_start, ps.captured_at as power_start_at,
      pe.power as power_end, pe.captured_at as power_end_at,
      case when ps.power is null or ps.power = 0 or pe.power is null then null
           else (pe.power - ps.power)::numeric / ps.power * 100 end as power_growth,
      -- Null when presence was never observed inside the period; 0 while
      -- online; hours offline as of the period's end otherwise. `greatest`
      -- rather than a bare subtraction so a clock oddity cannot reintroduce a
      -- negative.
      case
        when pr.player_id is null then null
        when pr.online_state = 'offline' and pr.offline_since is not null
          then greatest(extract(epoch from period_end - pr.offline_since) / 3600, 0)
        else 0
      end as offline_hours
    from members m
    left join contribution c using (player_id)
    left join power_at_start ps using (player_id)
    left join power_at_end pe using (player_id)
    left join presence pr using (player_id)
  ),
  -- WHO IS BEING COMPARED. Percentiles are relative, so who is in the pool
  -- changes everybody's answer — and two groups do not belong in it:
  --
  --   R4 and R5 are the leader and the officers. They are not competing for a
  --   promotion, and leaving them in drags every percentile: a leader with the
  --   alliance's largest donation total pushes the whole membership down a rank
  --   for something nobody was competing over.
  --
  --   Members we have watched for less than the two weeks the period covers
  --   cannot have a fortnight's contribution, so ranking them against people
  --   who could is scoring them for having joined late.
  --
  -- Both still get a row, with no tier and a reason. Dropping them from the
  -- output would leave an officer looking for a name that is simply absent.
  gradable as (
    select *,
      case
        when member_rank is not null and member_rank >= 4 then 'not graded: R4 and above'
        -- Only when the late join was actually WITNESSED. A null first_seen
        -- means we have no roster sighting of them, which is a gap in our data
        -- rather than a fact about the member — excluding on it would penalise
        -- somebody for what the collector missed, and an early version of this
        -- did exactly that and dropped every fixture member out of the pool.
        when first_seen is not null
             and first_seen > p_period_start - interval '14 days'
             and first_seen > roster_first_seen
          then 'not graded: joined within the last two weeks'
        else null
      end as excluded_because
    from figures
  ),
  ranked as (
    select g.*,
      -- Percentiles over the graded pool only. `filter` inside the window
      -- would still count the excluded rows in the denominator, so the ranking
      -- runs on a partition that has them out: `partition by (excluded_because
      -- is null)` puts the graded in one group and the rest in another, and
      -- only the graded group's numbers are used below.
      case when g.excluded_because is null then
        100 * percent_rank() over (
          partition by (g.excluded_because is null) order by g.donation_total nulls first)
      end as donation_pct,
      case when g.excluded_because is null then
        100 * percent_rank() over (
          partition by (g.excluded_because is null) order by g.duel_total nulls first)
      end as duel_pct,
      case when g.excluded_because is null then
        100 * percent_rank() over (
          partition by (g.excluded_because is null) order by g.power_growth nulls first)
      end as growth_pct
    from gradable g
  ),
  scored as (
    select *,
      -- Null when there is nothing to score on, or nobody to score. Every
      -- input absent used to produce 0, which then ranked and became a tier.
      case
        when excluded_because is not null then null
        when w_total is null then null
        when donation_total is null and duel_total is null and power_growth is null then null
        else (w_donation * donation_pct + w_duel * duel_pct + w_growth * growth_pct) / w_total
      end as activity_score
    from ranked
  ),
  placed as (
    select *,
      100 * percent_rank() over (order by activity_score desc nulls last) as place
    from scored
  )
  insert into public.rank_period_snapshots (
    period_start, player_id, game_uid, name, scoring_version,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours, tier, tier_reason)
  select
    p_period_start, player_id, game_uid, current_name, 2,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours,
    -- No score, no tier. The offline rule still applies when presence WAS
    -- observed, because "away for two weeks" is an answer even with no
    -- contribution captures.
    case
      -- Excluded first: an officer being told they are R1 for being offline is
      -- a judgement nobody asked this to make.
      when excluded_because is not null then null
      when offline_hours is not null and offline_hours >= offline_cut then 'R1'
      when activity_score is null then null
      when place < r3 then 'R3'
      when place < r3 + r2 then 'R2'
      else 'R1'
    end,
    case
      when excluded_because is not null then excluded_because
      when offline_hours is not null and offline_hours >= offline_cut then 'offline'
      when activity_score is null then 'nothing was captured for this member in this period'
      else 'score'
    end
  from placed
  on conflict (period_start, player_id, scoring_version) do update set
    game_uid = excluded.game_uid, name = excluded.name,
    donation_week1 = excluded.donation_week1, donation_week1_at = excluded.donation_week1_at,
    donation_week2 = excluded.donation_week2, donation_week2_at = excluded.donation_week2_at,
    duel_week1 = excluded.duel_week1, duel_week1_at = excluded.duel_week1_at,
    duel_week2 = excluded.duel_week2, duel_week2_at = excluded.duel_week2_at,
    donation_total = excluded.donation_total, duel_total = excluded.duel_total,
    power_start = excluded.power_start, power_start_at = excluded.power_start_at,
    power_end = excluded.power_end, power_end_at = excluded.power_end_at,
    power_growth = excluded.power_growth,
    donation_pct = excluded.donation_pct, duel_pct = excluded.duel_pct,
    growth_pct = excluded.growth_pct, activity_score = excluded.activity_score,
    offline_hours = excluded.offline_hours, tier = excluded.tier,
    tier_reason = excluded.tier_reason, computed_at = now();

  get diagnostics written = row_count;
  return written;
end;
$$;
