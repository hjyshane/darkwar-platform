-- 0159: while a season is running, a season building moves the score.
--
-- Season 3 is what the alliance actually spends its fortnight on, and none of
-- it reached the rank: the score mixes donation, duel and power growth, all
-- three of which a member can top while never touching the season map. The
-- board therefore ranked people by everything except the thing being asked of
-- them.
--
-- WHAT IT DOES. Inside a season window, one named season building adjusts the
-- score: a member below `low` loses `penalty` points, a member at `high` or
-- above gains `bonus`, and everybody between them is scored exactly as before.
-- Tiering is untouched -- the adjusted score goes through the same percentile
-- cuts, so the tiers stay the shares of the roster they have always been and
-- nothing here can produce an R4. The season only changes who is where.
--
-- ONLY WHILE THE SEASON RUNS, and the PERIOD'S START decides which rule it
-- gets. A fortnight that opened before `starts_at` is scored the old way even
-- if it ends inside the season. That keeps every period whole -- no score is
-- half one rule and half the other -- and it is why rebuilding a period from
-- last year still reproduces the number it was originally given. Between
-- seasons, or with the window switched off, this migration changes nobody's
-- score at all.
--
-- IT IS A SETTING BECAUSE IT HAPPENS AGAIN. Season 4 will want the same rule
-- with a different building, different levels and different dates, and that
-- should be a form on the admin page rather than a migration. `building_id`
-- is part of the setting for the same reason: nothing here is specific to the
-- thermal lab, and next season's building will have a different id.
--
--   "season_lab": {
--     "enabled": true,
--     "starts_at": "2026-09-10T02:00:00Z",
--     "ends_at":   "2026-11-10T02:00:00Z",
--     "building_id": 862000,
--     "low": 15,
--     "high": 22,
--     "penalty": 10,
--     "bonus": 10
--   }
--
-- PENALTY AND BONUS ARE POINTS ON THE SCORE, and they default to zero. The
-- request said "minus one, plus one", which on a 0-100 blend of percentiles
-- would be about a third of one place in an 84-member alliance -- invisible.
-- Rather than guess a size, both are numbers the alliance sets, and a window
-- switched on before anybody chooses them moves nobody. Ten points is roughly
-- ten percentile places, which is the scale worth starting from.
--
-- A LEVEL NOBODY HAS SEEN IS NOT A LOW LEVEL. The penalty needs a sighting;
-- an unswept member is left alone. This is the same rule the building board
-- already states on screen -- an empty cell is a gap in our sweep, not a
-- member who built nothing -- and without it the penalty would fall on
-- whoever the collector missed rather than on whoever is behind.
--
-- SCORING VERSION 5 -> 6, unconditionally, because the function's arithmetic
-- changed whether or not the window is open. As 0155 noted for the same
-- reason: `rank_period_movement` compares periods of one version, so the
-- previous-period column shows nothing until a second period exists under 6.
-- That is correct rather than broken.

alter table public.rank_period_snapshots
  add column if not exists lab_level int,
  add column if not exists lab_adjustment numeric not null default 0;

comment on column public.rank_period_snapshots.lab_level is
  'Level of the season building named in the season_lab setting, as it stood '
  'at the END of this period. Null means no sighting at or before then, which '
  'is a gap in the sweep rather than an unbuilt building -- and never a '
  'penalty.';
comment on column public.rank_period_snapshots.lab_adjustment is
  'Points the season building added to or took off this score. Zero outside a '
  'season window, zero for an unseen level, and zero for a level between the '
  'two thresholds.';

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
    p_period_start, player_id, game_uid, current_name, 6,
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
  'Scoring version 6 (0159): while a season window is open, the season '
  'building named in the setting adjusts the score -- below `low` costs '
  '`penalty` points, `high` or above earns `bonus`, an unseen level costs '
  'nothing. The period START decides whether the window applies, and tiering '
  'is unchanged. Version 5 (0155) is still what a weekly reading under the '
  'alliance minimum does: one tier step down, and below_minimum set either '
  'way.';
