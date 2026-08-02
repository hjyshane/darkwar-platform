-- 0056: how a figure is normalised becomes a choice.
--
-- 0054 ranked every figure by percentile, which fixed the real problem —
-- weighting raw numbers meant weighting the duel board alone, since it runs
-- about a hundred times the donation board — but it throws away magnitude.
-- Somebody who donated ten times the runner-up scores the same 100 as
-- somebody who edged them by one point, and "who actually carried the
-- alliance" is exactly the question that difference answers.
--
-- So the method is a setting. All four put the three figures on comparable
-- scales, which is all the mixing requires; none is right for everything:
--
--   percentile   rank inside the alliance, 0-100. Ignores outliers
--                completely — and ignores the person carrying everyone.
--   share        the member's share of the alliance total, x/sum. Keeps
--                magnitude and reads as a sentence: "4% of the donations".
--                One dominant member flattens the rest toward zero.
--   zscore       standard deviations from the mean. Keeps magnitude and
--                spreads the middle out, but a single huge donor moves the
--                mean and the spread, so everyone else shifts because of
--                one person.
--   median       multiples of the median, x/median. Robust the way the
--                median is — one outlier does not move it — while still
--                saying "twice the typical member" rather than "top decile".
--
-- The tier is assigned from the percentile of the FINAL score whatever is
-- chosen here, so the absolute size of activity_score varies by method and
-- only its ordering is load-bearing. The report says which method produced
-- the number it is showing.
--
-- A figure with no spread — everybody identical, or an alliance of one —
-- divides by zero under three of the four. Each falls back to 0, meaning
-- "this figure separates nobody", which is true and is not the same as
-- everyone scoring zero overall: the other two figures still rank people.

create or replace function public.build_rank_period(p_period_start timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  week_ends timestamptz[] := public.rank_period_week_ends(p_period_start);
  settings jsonb;
  w_donation numeric;
  w_duel numeric;
  w_growth numeric;
  w_total numeric;
  offline_cut numeric;
  method text;
  r3 numeric;
  r2 numeric;
  written integer;
begin
  if public.current_app_role() not in ('member', 'officer', 'admin') then
    raise exception 'building a rank period requires alliance membership'
      using errcode = '42501';
  end if;

  select value into settings from public.app_settings where key = 'rank_tiers';
  w_donation := coalesce((settings -> 'weights' ->> 'donation')::numeric, 0);
  w_duel := coalesce((settings -> 'weights' ->> 'duel')::numeric, 0);
  w_growth := coalesce((settings -> 'weights' ->> 'power_growth')::numeric, 0);
  w_total := nullif(w_donation + w_duel + w_growth, 0);
  offline_cut := coalesce((settings ->> 'offline_hours')::numeric, 48);
  method := coalesce(settings ->> 'normalisation', 'percentile');
  r3 := coalesce((settings ->> 'r3_percent')::numeric, 20);
  r2 := coalesce((settings ->> 'r2_percent')::numeric, 50);

  with members as (
    select p.player_id, p.game_uid, p.current_name
    from public.players p
    join public.alliances a on a.alliance_id = p.current_alliance_id
    where a.is_own
  ),
  -- Each week reads from its OWN window. Week 1 is (period start, its
  -- 01:59]; week 2 is (week 1's 01:59, its own]. Overlapping them let a
  -- single capture answer for both.
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
      and s.captured_at <= p_period_start + interval '14 days'
      and s.captured_at > p_period_start
    order by m.player_id, s.captured_at desc
  ),
  presence as (
    select distinct on (m.player_id) m.player_id, pr.online_state, pr.offline_since
    from members m
    join public.player_presence pr on pr.player_id = m.player_id
    order by m.player_id, pr.observed_at desc
  ),
  figures as (
    select
      m.player_id, m.game_uid, m.current_name,
      c.donation_week1, c.donation_week1_at, c.donation_week2, c.donation_week2_at,
      c.duel_week1, c.duel_week1_at, c.duel_week2, c.duel_week2_at,
      coalesce(c.donation_week1, 0) + coalesce(c.donation_week2, 0) as donation_total,
      coalesce(c.duel_week1, 0) + coalesce(c.duel_week2, 0) as duel_total,
      ps.power as power_start, ps.captured_at as power_start_at,
      pe.power as power_end, pe.captured_at as power_end_at,
      case when ps.power is null or ps.power = 0 or pe.power is null then null
           else (pe.power - ps.power)::numeric / ps.power * 100 end as power_growth,
      case when pr.online_state = 'offline' and pr.offline_since is not null
           then extract(epoch from (p_period_start + interval '14 days') - pr.offline_since) / 3600
           else 0 end as offline_hours
    from members m
    left join contribution c using (player_id)
    left join power_at_start ps using (player_id)
    left join power_at_end pe using (player_id)
    left join presence pr using (player_id)
  ),
  stats as (
    select
      sum(donation_total)::numeric as donation_sum,
      avg(donation_total)::numeric as donation_avg,
      stddev_pop(donation_total)::numeric as donation_sd,
      percentile_cont(0.5) within group (order by donation_total)::numeric as donation_med,
      sum(duel_total)::numeric as duel_sum,
      avg(duel_total)::numeric as duel_avg,
      stddev_pop(duel_total)::numeric as duel_sd,
      percentile_cont(0.5) within group (order by duel_total)::numeric as duel_med,
      sum(power_growth)::numeric as growth_sum,
      avg(power_growth)::numeric as growth_avg,
      stddev_pop(power_growth)::numeric as growth_sd,
      percentile_cont(0.5) within group (order by power_growth)::numeric as growth_med
    from figures
  ),
  ranked as (
    select f.*,
      case method
        when 'share' then 100 * f.donation_total / nullif(s.donation_sum, 0)
        when 'zscore' then (f.donation_total - s.donation_avg) / nullif(s.donation_sd, 0)
        when 'median' then 100 * f.donation_total / nullif(s.donation_med, 0)
        else 100 * percent_rank() over (order by f.donation_total)
      end as donation_pct,
      case method
        when 'share' then 100 * f.duel_total / nullif(s.duel_sum, 0)
        when 'zscore' then (f.duel_total - s.duel_avg) / nullif(s.duel_sd, 0)
        when 'median' then 100 * f.duel_total / nullif(s.duel_med, 0)
        else 100 * percent_rank() over (order by f.duel_total)
      end as duel_pct,
      case method
        when 'share' then 100 * f.power_growth / nullif(s.growth_sum, 0)
        when 'zscore' then (f.power_growth - s.growth_avg) / nullif(s.growth_sd, 0)
        when 'median' then 100 * f.power_growth / nullif(s.growth_med, 0)
        else 100 * percent_rank() over (order by f.power_growth nulls first)
      end as growth_pct
    from figures f
    cross join stats s
  ),
  scored as (
    select *,
      case when w_total is null then null
           -- A figure that separates nobody contributes nothing rather than
           -- voiding the whole score. coalesce, not "null poisons the sum".
           else (w_donation * coalesce(donation_pct, 0)
               + w_duel * coalesce(duel_pct, 0)
               + w_growth * coalesce(growth_pct, 0)) / w_total
      end as activity_score
    from ranked
  ),
  placed as (
    select *,
      100 * percent_rank() over (order by activity_score desc nulls last) as place
    from scored
  )
  insert into public.rank_period_snapshots (
    period_start, player_id, game_uid, name,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours, tier, tier_reason)
  select
    p_period_start, player_id, game_uid, current_name,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours,
    case when offline_hours >= offline_cut then 'R1'
         when place < r3 then 'R3'
         when place < r3 + r2 then 'R2'
         else 'R1' end,
    case when offline_hours >= offline_cut then 'offline' else 'score' end
  from placed
  on conflict (period_start, player_id) do update set
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
