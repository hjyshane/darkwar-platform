-- 0161: score the alliance, not everyone who was ever in it.
--
-- The rank build has always chosen its members like this:
--
--   from public.players p
--   join public.alliances a on a.alliance_id = p.current_alliance_id
--   where a.is_own
--
-- `current_alliance_id` is a LAST KNOWN alliance. Every writer since 0008 sets
-- it with `coalesce(s.alliance_id, p.current_alliance_id)` and nothing anywhere
-- clears it, so joining is recorded and leaving never is. CLAUDE.md has warned
-- about this column since it named 94 players for a roster of 84; 0139 made the
-- same mistake on the season board and 0146 fixed it. The scorer was never
-- looked at.
--
-- On the fortnight opening 2026-08-17 it scored 96 people for a roster of 82.
--
-- IT WAS NOT COSMETIC. A tier is a percentile of the pool, and the fourteen
-- ghosts sat in the denominator of `placed` carrying null scores -- they are
-- neither `unranked` nor `unmeasured`, so nothing excluded them from the count.
-- `place` was therefore measured against 96 rather than 82, which pushed every
-- percentile down and handed out more R3s than `r3_percent` asks for. Expect
-- tiers to TIGHTEN after this, and expect some people to move down a step
-- without having done anything differently: they were above the line only
-- because the line was drawn against a bigger crowd.
--
-- Membership now comes from `alliance_roster_latest` -- the newest roster
-- snapshot -- which is the source CLAUDE.md names and the one `member_roster`
-- (0102) and `member_season_buildings` (0146) already use.
--
-- ONE CONSEQUENCE WORTH KNOWING. The roster is the CURRENT one, so a member who
-- leaves tomorrow drops out of this fortnight's score when it is next rebuilt,
-- even though they were here for all of it. That is what was asked for -- the
-- report exists to decide who to promote and demote NOW, and a leaver is not a
-- candidate -- but it does mean a rebuilt old period can shrink. The scores
-- already written under version 6 keep the pool they were computed with, which
-- is the whole point of never overwriting a version.
--
-- SCORING VERSION 6 -> 7. Same note as 0155 and 0159: `rank_period_movement`
-- compares periods of one version, so the previous-period column shows nothing
-- until a second period exists under 7.

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
  lab_on boolean;
  lab_building int;
  lab_low numeric;
  lab_high numeric;
  lab_penalty numeric;
  lab_bonus numeric;
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
  -- THE PERIOD'S START DECIDES, not today and not the period's end. A
  -- fortnight is scored by whichever rule was in force on the day it opened,
  -- so no period is ever half one rule and half the other, and rebuilding an
  -- old period long afterwards still reproduces the score it was given.
  --
  -- Half-open on purpose: a period starting exactly at `ends_at` is the first
  -- one after the season, not the last one inside it. The defaults are the
  -- infinities that make an absent date fail rather than pass -- a missing
  -- `starts_at` must not read as "since the beginning of time".
  lab_on := coalesce((settings -> 'season_lab' ->> 'enabled')::boolean, false)
    and p_period_start >= coalesce(
      (settings -> 'season_lab' ->> 'starts_at')::timestamptz, 'infinity')
    and p_period_start < coalesce(
      (settings -> 'season_lab' ->> 'ends_at')::timestamptz, '-infinity');
  lab_building := (settings -> 'season_lab' ->> 'building_id')::int;
  lab_low := coalesce((settings -> 'season_lab' ->> 'low')::numeric, 0);
  lab_high := coalesce((settings -> 'season_lab' ->> 'high')::numeric, 0);
  -- Both default to zero, so a season window switched on before anybody
  -- chooses the sizes moves nobody. Same reasoning as the minimums in 0155.
  lab_penalty := coalesce((settings -> 'season_lab' ->> 'penalty')::numeric, 0);
  lab_bonus := coalesce((settings -> 'season_lab' ->> 'bonus')::numeric, 0);

  with own_alliance as (
    select a.alliance_id from public.alliances a where a.is_own limit 1
  ),
  roster_start as (
    select min(s.captured_at) as roster_first_seen
    from public.alliance_member_snapshots s
    where s.alliance_id = (select alliance_id from own_alliance)
  ),
  -- WHO IS SCORED. `alliance_roster_latest` -- the newest roster snapshot --
  -- and never `players.current_alliance_id`, which is a LAST KNOWN alliance:
  -- every writer sets it with coalesce(s.alliance_id, p.current_alliance_id)
  -- and nothing clears it, so joining is recorded and leaving never is.
  -- Scoring through it counted every departure since the beginning: 96 people
  -- for a roster of 82.
  --
  -- That was not cosmetic. A tier is a percentile of the pool, and the ghosts
  -- sat in the denominator carrying null scores, so `place` was measured
  -- against 96 instead of 82 and the r3 cut handed out more R3s than the
  -- setting asks for. Removing them tightens every tier back to its stated
  -- share.
  --
  -- The join through `players` is what drops a roster row whose player_id was
  -- never resolved; such a row has no snapshots to score anyway.
  members as (
    select p.player_id, p.game_uid, p.current_name,
      mr.member_rank, sn.first_seen, rs.roster_first_seen
    from public.alliance_roster_latest r
    join public.players p on p.player_id = r.player_id
    cross join roster_start rs
    left join lateral (
      select min(s.captured_at) as first_seen
      from public.alliance_member_snapshots s
      where s.player_id = p.player_id
        and s.alliance_id = (select alliance_id from own_alliance)
    ) sn on true
    left join lateral (
      select s.member_rank
      from public.alliance_member_snapshots s
      where s.player_id = p.player_id
        and s.alliance_id = (select alliance_id from own_alliance)
        and s.captured_at <= period_end
      order by s.captured_at desc
      limit 1
    ) mr on true
    where r.alliance_id = (select alliance_id from own_alliance)
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
      end as offline_hours,
      lab.level as lab_level
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
    -- The level AS OF THE PERIOD'S END, probed the way power already is, and
    -- deliberately NOT through `member_season_buildings` (0146). That view is
    -- newest-overall with no time bound, so scoring through it would rebuild
    -- a finished period using today's levels.
    --
    -- By game_uid, which is the index this table carries for exactly this
    -- question (0138). No lower bound on the probe: a building keeps its level
    -- until it is next seen, so the newest sighting at or before the period
    -- end IS the level then, however old that sighting is.
    left join lateral (
      select s.level
      from public.season_building_snapshots s
      where lab_on
        and lab_building is not null
        and s.game_uid = m.game_uid
        and s.building_type_id = lab_building
        and s.level is not null
        and s.captured_at <= period_end
      order by s.captured_at desc
      limit 1
    ) lab on true
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
  -- A LEVEL NOBODY HAS SEEN IS NOT A LOW LEVEL. `lab_level is null` taking
  -- the zero branch is the whole rule, and it is the same rule the building
  -- board states on screen: an empty cell is a gap in our sweep, not a member
  -- who built nothing. Without it the penalty would land on whoever the
  -- collector happened to miss, which on the current grid is most of them.
  --
  -- A floor of zero is no floor, matching how the weekly minimums read their
  -- own numbers -- otherwise `level < 0` never fires but `level >= 0` fires
  -- for everybody, and switching the window on with no levels chosen would
  -- hand the whole alliance the bonus.
  adjusted as (
    select *,
      case
        when lab_level is null then 0
        when lab_low > 0 and lab_level < lab_low then -lab_penalty
        when lab_high > 0 and lab_level >= lab_high then lab_bonus
        else 0
      end as lab_adjustment
    from ranked
  ),
  scored as (
    select *,
      case
        when unmeasured then null
        when w_total is null then null
        when donation_total is null and duel_total is null and power_growth is null then null
        -- Added AFTER the weights are divided out, so it is a flat move in
        -- score points rather than a fourth weighted component. That is what
        -- makes "under the floor costs N" mean the same N whatever the
        -- weights are set to.
        --
        -- NOT CLAMPED to 0-100. The blend is a mix of percentiles and a bonus
        -- can carry a member past 100; clamping would flatten everyone the
        -- bonus reached into a tie at the top and throw away the ordering the
        -- bonus exists to create. The score simply stops being a percentile
        -- while a season is running, which is what `lab_adjustment` records.
        else (w_donation * coalesce(donation_pct, 0)
              + w_duel * coalesce(duel_pct, 0)
              + w_growth * coalesce(growth_pct, 0)) / w_total
             + lab_adjustment
      end as activity_score
    from adjusted
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
    offline_hours, tier, tier_reason, below_minimum, minimum_missed,
    lab_level, lab_adjustment)
  select
    p_period_start, player_id, game_uid, current_name, 7,
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
      when lab_adjustment < 0 then 'score, minus ' || abs(lab_adjustment)
        || ' for a season building below level ' || lab_low
      when lab_adjustment > 0 then 'score, plus ' || lab_adjustment
        || ' for a season building at level ' || lab_high || ' or above'
      else 'score'
    end,
    below_minimum,
    minimum_missed,
    lab_level,
    lab_adjustment
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
    lab_level = excluded.lab_level, lab_adjustment = excluded.lab_adjustment,
    computed_at = now();

  get diagnostics written = row_count;
  return written;
end;
$$;

comment on function public.build_rank_period(timestamptz) is
  'Scores one fortnight for the own alliance and writes rank_period_snapshots. '
  'Every per-member figure is an index probe (0110). Officer and up (0112). '
  'Scoring version 7 (0161): membership comes from alliance_roster_latest, '
  'never from players.current_alliance_id -- that column is a last known '
  'alliance and scoring through it counted every departure since the '
  'beginning, inflating the percentile denominator and the tiers with it. '
  'Version 6 (0159) is the season building adjustment; version 5 (0155) is the '
  'weekly minimum costing one tier step.';
