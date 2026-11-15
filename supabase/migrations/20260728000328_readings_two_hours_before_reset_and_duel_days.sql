-- 0328: the weekly readings move to two hours before the reset, and the duel
-- half of the score can be a count of days instead of a sum of points.
--
-- READINGS. 0309 put the weekly readings at Sunday 14:00Z, twelve hours before
-- the Monday 02:00Z reset, so the officer who posts the ranking could finish
-- it on Sunday afternoon. The alliance has since asked for the ranking to take
-- everything up to two hours before the reset instead: Monday 00:00Z, which
-- is 22:00 on Sunday on the game's own clock (UTC-2). Whatever a member does
-- in the final two hours still counts in the game; it no longer counts in the
-- rank. Nothing captured between the deadline and the reset belongs to either
-- week (0309's rule, unchanged; the seam is now two hours wide, not twelve).
--
-- Both functions that state the instant change here and nowhere else:
-- rank_period_week_ends (a fortnight, 0309) and rank_period_reading_ends (any
-- length, 0316). Every reader of the moment - the build, the running-period
-- view, the dashboard's rankPeriodReadingEnds - takes it from one of these.
--
-- DUEL DAYS. The duel weight has always been applied to the WEEKLY duel board,
-- a sum of points, put through the same percentile as the donation figure. The
-- alliance wants the option of scoring the duel on attendance instead: how many
-- of the week's duel days a member cleared a floor on, where the floor is set
-- per weekday because the duel's days are not alike (Saturday's kill day is
-- worth many times a Tuesday). Under `rank_tiers`:
--
--   "duel_scoring": "points" | "days"          -- default points, as before
--   "duel_daily_minimums": {"mon": N, "tue": N, "wed": N, "thu": N, "fri": N, "sat": N}
--
-- In `days` mode the duel figure a member is ranked on is the number of duel
-- days (Monday to Saturday, 0213: Sunday is not a duel day) in the period on
-- which their DAILY duel board, read at the end of the game day, met that
-- weekday's floor. A weekday whose floor is 0 is not required and not counted.
-- The count goes through the same percentile the points did, so the weights,
-- the tier cuts, the weekly minimums and the season rule all read exactly as
-- before - only what "duel" measures changes. The weekly points are still read
-- and stored, so the report can show both.
--
-- A DAY NOBODY READ IS NOT A MISSED DAY. The daily board is read by the
-- collector's 01:59Z sweep (the game day is 02:00Z to 02:00Z, 0213), and on a
-- day the collector was off there is no reading for anybody. Such a day is
-- left out of the count rather than scored as a miss, which is the same rule
-- the weekly minimums use for an unread week (0155). Because the whole
-- alliance loses the same day, the percentile is unaffected; the snapshot
-- records how many days WERE read (`duel_days_read`) beside how many were met
-- (`duel_days_met`) so the report can say so. A member with no daily reading
-- at all in the period has a null count, not zero - "not read", kept apart
-- from "read and never met", as every other figure here is.
--
-- The game day is read as 0213 reads it: the newest `alliance_battle_daily`
-- capture in (day_start, day_start + 1 day - 1 minute]. The weekday is the
-- day's position in the game week, which opens on the reset: day 0 is Monday.
--
-- Scoring version 10. The formula under `points` is unchanged, but the weekly
-- inputs are read at a different moment, so a period rebuilt now does not
-- reproduce the figures posted under 9 - the same reason 0309 bumped to 9.
-- Historical rows keep their version; rank_period_latest takes the newest
-- version per period as before (0089). The snapshot records which duel mode
-- scored it (`duel_scoring`), because a `days` row and a `points` row carry
-- different meanings in `duel_pct` and the report has to know which it holds.

create or replace function public.rank_period_week_ends(period_start timestamptz)
returns timestamptz[]
language sql
immutable
strict
set search_path = ''
as $$
  select array[
    period_start + interval '7 days' - interval '2 hours',
    period_start + interval '14 days' - interval '2 hours'
  ]
$$;

comment on function public.rank_period_week_ends(timestamptz) is
  'Monday 00:00Z closing each of the period''s two weeks - two hours before '
  'the game wipes the weekly boards, 22:00 Sunday server time (0328; 14:00Z on '
  'the Sunday before that, 0309).';

create or replace function public.rank_period_reading_ends(period_start timestamptz, period_end timestamptz)
returns timestamptz[]
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    array_agg(period_start + (n * interval '7 days') - interval '2 hours' order by n),
    '{}'::timestamptz[])
  from generate_series(
    1, floor(extract(epoch from (period_end - period_start)) / 604800)::int) as n
$$;

comment on function public.rank_period_reading_ends(timestamptz, timestamptz) is
  'Monday 00:00Z closing each week in [period_start, period_end): the moments '
  'the weekly boards are read, two hours before the game clears them (0328). '
  'One entry per whole week; a four-week period has four.';

-- ---------------------------------------------------------------------------
-- What the snapshot records about the duel days.

alter table public.rank_period_snapshots
  add column duel_days_met integer,
  add column duel_days_read integer,
  add column duel_scoring text not null default 'points'
    check (duel_scoring in ('points', 'days'));

comment on column public.rank_period_snapshots.duel_days_met is
  'Duel days in the period on which the member''s daily duel board met that '
  'weekday''s floor (0328). Null unless scored under duel_scoring = days with '
  'at least one day read.';
comment on column public.rank_period_snapshots.duel_days_read is
  'Duel days in the period the member''s daily duel board was read on, among '
  'the weekdays with a floor (0328). Null unless scored under days.';
comment on column public.rank_period_snapshots.duel_scoring is
  'Which duel figure duel_pct ranks: points (the weekly board sum, as always) '
  'or days (duel_days_met). Rows from before 0328 are points.';

-- THE STAR IS FROZEN AT CREATION (0160, 0163, 0316): re-created to see the
-- new columns.
create or replace view public.rank_period_latest
with (security_invoker = true) as
with newest as (
  select period_start, max(scoring_version) as scoring_version
  from public.rank_period_snapshots
  group by period_start
)
select distinct on (s.period_start, s.player_id) s.*
from public.rank_period_snapshots s
join newest n
  on n.period_start = s.period_start
 and n.scoring_version = s.scoring_version
order by s.period_start, s.player_id, s.computed_at desc;

-- ---------------------------------------------------------------------------
-- The scorer, as 0316 wrote it, with the duel figure chosen by the setting
-- and the version at 10.

create or replace function public.build_rank_period(p_period_start timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written integer;
  v_bounds record;
  week_ends timestamptz[];
  v_period_end timestamptz;
  measured_to timestamptz;
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
  -- Which duel figure is ranked (0328): 'points' or 'days'.
  duel_mode text;
  -- The per-weekday floors for 'days' mode, keyed mon..sat. Read as an
  -- array indexed by the day's position in the game week (1 = Monday).
  day_floors numeric[];
  -- The alliance being built: the one being viewed (0193). One alliance
  -- per call, never a loop over all of them - 0110 measured this function
  -- at the edge of the statement timeout for one.
  v_alliance uuid := public.active_alliance();
begin
  -- Officer and up (0112).
  if public.current_app_role() not in ('officer', 'admin') then
    raise exception 'officers only' using errcode = '42501';
  end if;

  -- THE PERIOD'S OWN BOUNDS (0316), not two weeks assumed. A start that is not
  -- a period start under the rule now in force is refused rather than given a
  -- guessed end: it is either a hand-set period that has since been changed,
  -- or a date typed into the wrong box.
  select b.period_start, b.period_end into v_bounds
  from public.rank_period_bounds(p_period_start, v_alliance) b;
  if v_bounds.period_start <> p_period_start then
    raise exception 'not the start of a rank period: the period containing % starts at %',
      p_period_start, v_bounds.period_start
      using errcode = '22023';
  end if;
  v_period_end := v_bounds.period_end;
  week_ends := public.rank_period_reading_ends(p_period_start, v_period_end);
  measured_to := least(v_period_end, now());

  settings := public.alliance_setting('rank_tiers', v_alliance);
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
  -- Points unless the setting says days, and points again if it says anything
  -- else: a typo in a hand-edited setting must score as before, not as nothing.
  duel_mode := case when settings ->> 'duel_scoring' = 'days' then 'days' else 'points' end;
  -- Monday to Saturday. Sunday is not a duel day (0213) and has no floor. A
  -- missing or unreadable floor is 0, which is "not required" below.
  day_floors := array[
    coalesce((settings -> 'duel_daily_minimums' ->> 'mon')::numeric, 0),
    coalesce((settings -> 'duel_daily_minimums' ->> 'tue')::numeric, 0),
    coalesce((settings -> 'duel_daily_minimums' ->> 'wed')::numeric, 0),
    coalesce((settings -> 'duel_daily_minimums' ->> 'thu')::numeric, 0),
    coalesce((settings -> 'duel_daily_minimums' ->> 'fri')::numeric, 0),
    coalesce((settings -> 'duel_daily_minimums' ->> 'sat')::numeric, 0)
  ];
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
    select v_alliance as alliance_id
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
        and s.captured_at <= v_period_end
      order by s.captured_at desc
      limit 1
    ) mr on true
    where r.alliance_id = (select alliance_id from own_alliance)
  ),
  -- ONE WINDOW PER WEEK THE PERIOD HAS (0316), not two assumed. Each week
  -- opens at the RESET (0309), not at the previous week's reading: a capture
  -- taken between a deadline and the reset belongs to neither.
  reading as (
    select m.player_id, w.idx, t.kind, c.score, c.captured_at
    from members m
    cross join lateral (
      select n as idx,
        p_period_start + ((n - 1) * interval '7 days') as opens,
        week_ends[n] as closes
      from generate_series(1, cardinality(week_ends)) as n
    ) as w
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
      -- The first two weeks' readings, as the snapshot has always recorded
      -- them. A third or fourth week is in the sums below and nowhere else.
      max(score) filter (where kind = 'weekly_donation' and idx = 1) as donation_week1,
      max(captured_at) filter (where kind = 'weekly_donation' and idx = 1) as donation_week1_at,
      max(score) filter (where kind = 'weekly_donation' and idx = 2) as donation_week2,
      max(captured_at) filter (where kind = 'weekly_donation' and idx = 2) as donation_week2_at,
      max(score) filter (where kind = 'alliance_battle_weekly' and idx = 1) as duel_week1,
      max(captured_at) filter (where kind = 'alliance_battle_weekly' and idx = 1) as duel_week1_at,
      max(score) filter (where kind = 'alliance_battle_weekly' and idx = 2) as duel_week2,
      max(captured_at) filter (where kind = 'alliance_battle_weekly' and idx = 2) as duel_week2_at,
      -- Every week that was read. count() of a null-free column is the number
      -- of readings; zero readings is "not read", kept apart from a read zero.
      sum(score) filter (where kind = 'weekly_donation') as donation_sum,
      count(score) filter (where kind = 'weekly_donation') as donation_reads,
      sum(score) filter (where kind = 'alliance_battle_weekly') as duel_sum,
      count(score) filter (where kind = 'alliance_battle_weekly') as duel_reads,
      -- A week that was READ and came in under the floor, whichever week it
      -- was (0155's rule, over every week rather than two).
      bool_or(kind = 'weekly_donation' and score < min_donation) as donation_under,
      bool_or(kind = 'alliance_battle_weekly' and score < min_duel) as duel_under
    from reading
    group by player_id
  ),
  -- THE DUEL DAYS (0328), only under 'days' mode: one probe per member per
  -- duel day with a floor. Each week's six duel days open at the reset plus
  -- k days; day k's floor is day_floors[k + 1]. A day whose floor is 0 is not
  -- asked for. The reading is the newest daily-board capture inside the game
  -- day, as 0213 reads it; a day with no capture produces no row, so it is
  -- neither met nor missed - see the header.
  duel_day as (
    select m.player_id, d.floor_, c.score
    from members m
    cross join lateral (
      select
        p_period_start + ((n - 1) * interval '7 days') + (k * interval '1 day') as day_start,
        day_floors[k + 1] as floor_
      from generate_series(1, cardinality(week_ends)) as n
      cross join generate_series(0, 5) as k
    ) d
    cross join lateral (
      select s.score
      from public.alliance_contribution_snapshots s
      where s.game_uid = m.game_uid
        and s.contribution_type = 'alliance_battle_daily'
        and s.captured_at > d.day_start
        and s.captured_at <= d.day_start + interval '1 day' - interval '1 minute'
      order by s.captured_at desc
      limit 1
    ) c
    where duel_mode = 'days'
      and d.floor_ > 0
  ),
  duel_days as (
    select
      player_id,
      count(*)::int as days_read,
      (count(*) filter (where score >= floor_))::int as days_met
    from duel_day
    group by player_id
  ),
  figures as (
    select
      m.player_id, m.game_uid, m.current_name,
      m.member_rank, m.first_seen, m.roster_first_seen,
      c.donation_week1, c.donation_week1_at, c.donation_week2, c.donation_week2_at,
      c.duel_week1, c.duel_week1_at, c.duel_week2, c.duel_week2_at,
      case when coalesce(c.donation_reads, 0) = 0 then null else c.donation_sum end
        as donation_total,
      case when coalesce(c.duel_reads, 0) = 0 then null else c.duel_sum end
        as duel_total,
      -- Null in points mode and for a member with no daily reading at all;
      -- a left join with no match is exactly that null.
      dd.days_met as duel_days_met,
      dd.days_read as duel_days_read,
      -- THE FIGURE THE DUEL WEIGHT RANKS. The weekly points, or under 'days'
      -- the count of days met. Everything downstream compares this and never
      -- duel_total directly, so the two modes share one percentile.
      case
        when duel_mode = 'days' then dd.days_met::numeric
        when coalesce(c.duel_reads, 0) = 0 then null
        else c.duel_sum::numeric
      end as duel_figure,
      coalesce(c.donation_under, false) as donation_under,
      coalesce(c.duel_under, false) as duel_under,
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
    left join duel_days dd using (player_id)
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
        and s.captured_at <= v_period_end
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
        and s.captured_at <= v_period_end
      order by s.captured_at desc
      limit 1
    ) lab on true
  ),
  classified as (
    select *,
      (member_rank is not null and member_rank >= 4) as unranked,
      -- Joined DURING this period, so they could not have a full period's
      -- contribution — which is the reason 0072 gave, in 0072's own words.
      -- It used to read `p_period_start - interval '14 days'`, which excluded
      -- anyone first seen in the PREVIOUS fortnight too: a member who joined on
      -- 4 August was left unscored for the period running 17-31 August, having
      -- been present for every day of it. Four current members were unscorable
      -- for a fortnight at a time this way.
      (first_seen is not null
        and first_seen > p_period_start
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
          (select 100.0 * count(*) filter (where p.duel_figure < c.duel_figure)
                  / nullif(count(*) - 1, 0)
           from pool p)
        else
          (select 100.0 * count(*) filter (where p.duel_figure < c.duel_figure)
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
        when donation_total is null and duel_figure is null and power_growth is null then null
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
  -- A week that was READ and came in under the floor. An unread week — the
  -- weeks still to come in a running period, or a week the collector missed —
  -- is not evidence of anything, which is what the null-free bool_or above
  -- already means.
  checked as (
    select p.*,
      (mins_on and min_donation > 0 and p.donation_under) as donation_missed,
      (mins_on and min_duel > 0 and p.duel_under) as duel_missed
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
    period_start, period_end, player_id, game_uid, name, scoring_version,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours, tier, tier_reason, below_minimum, minimum_missed,
    lab_level, lab_adjustment, alliance_id,
    duel_days_met, duel_days_read, duel_scoring)
  select
    p_period_start, v_period_end, player_id, game_uid, current_name, 10,
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
      when unmeasured then 'not measured: joined during this period'
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
    lab_adjustment,
    v_alliance,
    duel_days_met,
    duel_days_read,
    duel_mode
  from graded
  on conflict (period_start, player_id, scoring_version) do update set
    period_end = excluded.period_end,
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
    alliance_id = excluded.alliance_id,
    duel_days_met = excluded.duel_days_met, duel_days_read = excluded.duel_days_read,
    duel_scoring = excluded.duel_scoring,
    computed_at = now();

  get diagnostics written = row_count;
  return written;
end;
$$;

comment on function public.build_rank_period(timestamptz) is
  'Scores one rank period for the alliance being viewed (0196) with its own '
  'rank_tiers, and writes rank_period_snapshots with alliance_id and the '
  'period''s end. The period''s bounds come from rank_period_bounds (0316): a '
  'start that is not a period start is refused. One Monday 00:00Z reading per '
  'week the period has (0328); week1/week2 columns hold the first two, the '
  'totals every week read. The duel figure is the weekly points or, under '
  'duel_scoring = days, the count of duel days over the weekday floor (0328). '
  'Every per-member figure is an index probe (0110). Officer and up (0112). '
  'Scoring version 10.';
