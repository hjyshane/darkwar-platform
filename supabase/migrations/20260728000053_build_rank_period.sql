-- 0053: work out one period from the observations inside it.
--
-- Recomputes rather than freezing. The inputs are append-only snapshots
-- bounded by fixed times, so running this twice on the same period gives the
-- same answer — unless a capture synced late, in which case the second run
-- is better. Freezing the first attempt would have locked in whatever
-- happened to have arrived by the moment somebody first opened the page.
create function public.build_rank_period(p_period_start timestamptz)
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
  r3 numeric;
  r2 numeric;
  written integer;
begin
  -- Alliance business: the figures are member-only wherever else they
  -- appear, and a SECURITY DEFINER function would otherwise be a way past
  -- that for anybody who could call it.
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
  r3 := coalesce((settings ->> 'r3_percent')::numeric, 20);
  r2 := coalesce((settings ->> 'r2_percent')::numeric, 50);

  with members as (
    select p.player_id, p.game_uid, p.current_name
    from public.players p
    join public.alliances a on a.alliance_id = p.current_alliance_id
    where a.is_own
  ),
  -- The newest reading at or before each week's 01:59. "At or before"
  -- because the collector may not have run at the minute asked for; the
  -- timestamp comes along so the report can say what it really used.
  reading as (
    select m.player_id, w.idx, w.cutoff, c.contribution_type, c.score, c.captured_at
    from members m
    cross join lateral (values (1, week_ends[1]), (2, week_ends[2])) as w(idx, cutoff)
    cross join lateral (values ('weekly_donation'), ('duel_weekly')) as t(kind)
    cross join lateral (
      select s.score, s.captured_at, s.contribution_type
      from public.alliance_contribution_snapshots s
      where s.game_uid = m.game_uid
        and s.contribution_type = t.kind
        and s.captured_at <= w.cutoff
        and s.captured_at > p_period_start
      order by s.captured_at desc
      limit 1
    ) c
  ),
  contribution as (
    select
      player_id,
      max(score) filter (where contribution_type = 'weekly_donation' and idx = 1) as donation_week1,
      max(captured_at) filter (where contribution_type = 'weekly_donation' and idx = 1) as donation_week1_at,
      max(score) filter (where contribution_type = 'weekly_donation' and idx = 2) as donation_week2,
      max(captured_at) filter (where contribution_type = 'weekly_donation' and idx = 2) as donation_week2_at,
      max(score) filter (where contribution_type = 'duel_weekly' and idx = 1) as duel_week1,
      max(captured_at) filter (where contribution_type = 'duel_weekly' and idx = 1) as duel_week1_at,
      max(score) filter (where contribution_type = 'duel_weekly' and idx = 2) as duel_week2,
      max(captured_at) filter (where contribution_type = 'duel_weekly' and idx = 2) as duel_week2_at
    from reading
    group by player_id
  ),
  -- Power at the period's own boundaries. It does not reset, so the
  -- boundary itself is a fine place to read it.
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
  -- Each figure ranked inside the alliance, 0-100. This is what makes the
  -- weights mean what they look like: the raw duel figure is a hundred
  -- times the donation one, so weighting the raw numbers is weighting the
  -- duel board alone.
  ranked as (
    select *,
      100 * percent_rank() over (order by donation_total) as donation_pct,
      100 * percent_rank() over (order by duel_total) as duel_pct,
      100 * percent_rank() over (order by power_growth nulls first) as growth_pct
    from figures
  ),
  scored as (
    select *,
      case when w_total is null then null
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
    -- The offline rule overrides the score outright. Somebody who has not
    -- logged in for two days is not contributing whatever their fortnight
    -- old figures say.
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

revoke all on function public.build_rank_period(timestamptz) from public;
grant execute on function public.build_rank_period(timestamptz) to authenticated;

comment on function public.build_rank_period(timestamptz) is
  'Compute one two-week period from the observations inside it and upsert a '
  'row per member. Idempotent; a late capture makes the next run better '
  'rather than being locked out by the first.';
