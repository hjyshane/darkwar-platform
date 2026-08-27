-- 0155: a weekly minimum, and one step down for missing it.
--
-- Until now the score was PURELY relative: percentiles inside the alliance,
-- mixed by weights. That answers "who did more than whom" and cannot answer
-- "did this person do enough" — in a quiet fortnight the bottom of the pool
-- still gets an R2 because somebody has to be in the middle. The alliance
-- states a floor out loud ("at least this much donation, at least this much
-- duel"), and the board had no way to say it.
--
-- WEEKLY ONLY, AND DELIBERATELY NOT DAILY. The daily boards exist
-- (`daily_donation`, `alliance_battle_daily`) and a daily floor was asked for,
-- but a daily figure is only as present as the collector's day: a member who
-- was never captured on a Tuesday is indistinguishable from a member who did
-- nothing on that Tuesday, and this repo's standing rule is that absence is
-- not zero. A daily minimum would therefore demote people for the collector's
-- gaps. The weekly boards are the two readings the score already rests on —
-- taken one minute before the game clears each week — so the floor sits where
-- the evidence is.
--
-- A MISSING WEEK IS NOT A MISS, for the same reason. Week two of a running
-- fortnight has not been read yet; a member with no reading is not below the
-- floor, they are unmeasured on that week. Only a week that WAS read and came
-- in under the number counts against them.
--
-- THE PENALTY IS ONE STEP, NOT A FLOOR OF ITS OWN: R3 becomes R2, R2 becomes
-- R1. R1 stays R1, because the game has no rank below it and inventing one
-- would put a tier on this board that nobody can act on in the game. For an
-- R1 the penalty is the flag itself — `below_minimum` is recorded either way,
-- so the screens can mark them in red and `minimum_missed` says which floor
-- they were under.
--
-- Officers (unranked) and newcomers (unmeasured) get the flag computed but no
-- demotion, because they have no tier to demote — 0072's separation of
-- "measured" from "ranked" is untouched.
--
-- SCORING VERSION 4 -> 5. The repo rule is that a scoring change never
-- overwrites history, and this changes what a tier MEANS. One consequence
-- worth stating plainly: `rank_period_movement` (0100) compares periods of the
-- same version, so until a second period is built under 5 the movement
-- highlights and the report's previous-period column will show nothing to
-- compare against. That is correct rather than broken — there is no earlier
-- period scored by these rules.
--
-- The floors live in the `rank_tiers` setting beside the weights:
--
--   "minimums": { "enabled": true, "donation_weekly": 0, "duel_weekly": 0 }
--
-- Absent or disabled, this migration changes nothing about anybody's tier.

alter table public.rank_period_snapshots
  add column if not exists below_minimum boolean not null default false,
  add column if not exists minimum_missed text;

comment on column public.rank_period_snapshots.below_minimum is
  'A week that WAS read came in under the alliance minimum. Computed for '
  'everyone including officers and newcomers; only demotes those who have a '
  'tier to lose.';
comment on column public.rank_period_snapshots.minimum_missed is
  'Which floor was missed: donation, duel, or both. Null when none was.';

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
  measured_to timestamptz := least(p_period_start + interval '14 days', now());
  settings jsonb;
  w_donation numeric;
  w_duel numeric;
  w_growth numeric;
  w_total numeric;
  offline_cut numeric;
  r3 numeric;
  r2 numeric;
  mins_on boolean;
  min_donation numeric;
  min_duel numeric;
begin
  -- Officer and up (0112).
  if public.current_app_role() not in ('officer', 'admin') then
    raise exception 'officers only' using errcode = '42501';
  end if;

  select value into settings from public.app_settings where key = 'rank_tiers';
  w_donation := coalesce((settings -> 'weights' ->> 'donation')::numeric, 0);
  w_duel := coalesce((settings -> 'weights' ->> 'duel')::numeric, 0);
  w_growth := coalesce((settings -> 'weights' ->> 'power_growth')::numeric, 0);
  w_total := nullif(w_donation + w_duel + w_growth, 0);
  offline_cut := coalesce((settings ->> 'offline_hours')::numeric, 48);
  r3 := coalesce((settings ->> 'r3_percent')::numeric, 20);
  r2 := coalesce((settings ->> 'r2_percent')::numeric, 50);
  -- Off unless somebody turned it on. A floor that arrives with a default
  -- number would demote people the first time this deploys, for a rule the
  -- alliance never agreed.
  mins_on := coalesce((settings -> 'minimums' ->> 'enabled')::boolean, false);
  min_donation := coalesce((settings -> 'minimums' ->> 'donation_weekly')::numeric, 0);
  min_duel := coalesce((settings -> 'minimums' ->> 'duel_weekly')::numeric, 0);

  with own_alliance as (
    select a.alliance_id from public.alliances a where a.is_own limit 1
  ),
  roster_start as (
    select min(s.captured_at) as roster_first_seen
    from public.alliance_member_snapshots s
    where s.alliance_id = (select alliance_id from own_alliance)
  ),
  members as (
    select p.player_id, p.game_uid, p.current_name,
      mr.member_rank, sn.first_seen, rs.roster_first_seen
    from public.players p
    join public.alliances a on a.alliance_id = p.current_alliance_id
    cross join roster_start rs
    left join lateral (
      select min(s.captured_at) as first_seen
      from public.alliance_member_snapshots s
      where s.player_id = p.player_id and s.alliance_id = a.alliance_id
    ) sn on true
    left join lateral (
      select s.member_rank
      from public.alliance_member_snapshots s
      where s.player_id = p.player_id
        and s.alliance_id = a.alliance_id
        and s.captured_at <= period_end
      order by s.captured_at desc
      limit 1
    ) mr on true
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
  figures as (
    select
      m.player_id, m.game_uid, m.current_name,
      m.member_rank, m.first_seen, m.roster_first_seen,
      c.donation_week1, c.donation_week1_at, c.donation_week2, c.donation_week2_at,
      c.duel_week1, c.duel_week1_at, c.duel_week2, c.duel_week2_at,
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
      case
        when pr.player_id is null then null
        when pr.online_state = 'offline' and pr.offline_since is not null
          then greatest(extract(epoch from measured_to - pr.offline_since) / 3600, 0)
        else 0
      end as offline_hours
    from members m
    left join contribution c using (player_id)
    left join lateral (
      select s.power, s.captured_at
      from public.player_snapshots s
      where s.player_id = m.player_id
        and s.power is not null
        and s.captured_at <= p_period_start
      order by s.captured_at desc
      limit 1
    ) ps on true
    left join lateral (
      select s.power, s.captured_at
      from public.player_snapshots s
      where s.player_id = m.player_id
        and s.power is not null
        and s.captured_at <= period_end
        and s.captured_at > p_period_start
      order by s.captured_at desc
      limit 1
    ) pe on true
    left join public.player_presence pr
      on pr.player_id = m.player_id and pr.observed_at <= measured_to
  ),
  classified as (
    select *,
      (member_rank is not null and member_rank >= 4) as unranked,
      (first_seen is not null
        and first_seen > p_period_start - interval '14 days'
        and first_seen > roster_first_seen) as unmeasured
    from figures
  ),
  pool as (
    select * from classified where not unranked and not unmeasured
  ),
  ranked as (
    select c.*,
      case
        when c.unmeasured then null
        when not c.unranked then
          (select 100.0 * count(*) filter (where p.donation_total < c.donation_total)
                  / nullif(count(*) - 1, 0)
           from pool p)
        else
          (select 100.0 * count(*) filter (where p.donation_total < c.donation_total)
                  / nullif(count(*), 0)
           from pool p)
      end as donation_pct,
      case
        when c.unmeasured then null
        when not c.unranked then
          (select 100.0 * count(*) filter (where p.duel_total < c.duel_total)
                  / nullif(count(*) - 1, 0)
           from pool p)
        else
          (select 100.0 * count(*) filter (where p.duel_total < c.duel_total)
                  / nullif(count(*), 0)
           from pool p)
      end as duel_pct,
      case
        when c.unmeasured then null
        when not c.unranked then
          (select 100.0 * count(*) filter (where p.power_growth < c.power_growth)
                  / nullif(count(*) - 1, 0)
           from pool p)
        else
          (select 100.0 * count(*) filter (where p.power_growth < c.power_growth)
                  / nullif(count(*), 0)
           from pool p)
      end as growth_pct
    from classified c
  ),
  scored as (
    select *,
      case
        when unmeasured then null
        when w_total is null then null
        when donation_total is null and duel_total is null and power_growth is null then null
        else (w_donation * coalesce(donation_pct, 0)
              + w_duel * coalesce(duel_pct, 0)
              + w_growth * coalesce(growth_pct, 0)) / w_total
      end as activity_score
    from ranked
  ),
  placed as (
    select s.*,
      case when s.unranked or s.unmeasured then null
      else
        (select 100.0 * count(*) filter (where p2.activity_score > s.activity_score)
                / nullif(count(*), 0)
         from scored p2 where not p2.unranked and not p2.unmeasured)
      end as place
    from scored s
  ),
  -- A week that was READ and came in under the floor. `is not null` on each
  -- side is the whole rule: an unread week — week two of a running fortnight,
  -- or a week the collector missed — is not evidence of anything.
  checked as (
    select p.*,
      (mins_on and min_donation > 0 and (
        (p.donation_week1 is not null and p.donation_week1 < min_donation)
        or (p.donation_week2 is not null and p.donation_week2 < min_donation)
      )) as donation_missed,
      (mins_on and min_duel > 0 and (
        (p.duel_week1 is not null and p.duel_week1 < min_duel)
        or (p.duel_week2 is not null and p.duel_week2 < min_duel)
      )) as duel_missed
    from placed p
  ),
  graded as (
    select c.*,
      (c.donation_missed or c.duel_missed) as below_minimum,
      case
        when c.donation_missed and c.duel_missed then 'donation and duel'
        when c.donation_missed then 'donation'
        when c.duel_missed then 'duel'
      end as minimum_missed,
      case
        when c.unmeasured then null
        when c.unranked then null
        when c.offline_hours is not null and c.offline_hours >= offline_cut then 'R1'
        when c.activity_score is null then null
        when c.place < r3 then 'R3'
        when c.place < r3 + r2 then 'R2'
        else 'R1'
      end as base_tier
    from checked c
  )
  insert into public.rank_period_snapshots (
    period_start, player_id, game_uid, name, scoring_version,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours, tier, tier_reason, below_minimum, minimum_missed)
  select
    p_period_start, player_id, game_uid, current_name, 5,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours,
    -- One step, and no lower than R1: the game has no rank beneath it.
    case
      when below_minimum then
        case base_tier when 'R3' then 'R2' when 'R2' then 'R1' else base_tier end
      else base_tier
    end,
    case
      when unmeasured then 'not measured: joined within the last two weeks'
      when unranked then 'measured but not ranked: R4 and above'
      when offline_hours is not null and offline_hours >= offline_cut then 'offline'
      when activity_score is null then 'nothing was captured for this member in this period'
      when below_minimum then 'below minimum: ' || minimum_missed
      else 'score'
    end,
    below_minimum,
    minimum_missed
  from graded
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
    tier_reason = excluded.tier_reason,
    below_minimum = excluded.below_minimum, minimum_missed = excluded.minimum_missed,
    computed_at = now();

  get diagnostics written = row_count;
  return written;
end;
$$;

comment on function public.build_rank_period(timestamptz) is
  'Scores one fortnight for the own alliance and writes rank_period_snapshots. '
  'Every per-member figure is an index probe (0110). Officer and up (0112). '
  'Scoring version 5 (0155): a weekly donation or duel reading below the '
  'alliance minimum costs one tier step — R3 to R2, R2 to R1, R1 stays R1 — '
  'and sets below_minimum either way. A week with no reading is never a miss.';
