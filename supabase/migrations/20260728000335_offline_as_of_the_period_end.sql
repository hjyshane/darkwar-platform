-- 0335: absence is read as it stood at the period's end, so rebuilding a
-- finished period no longer forgets who was away.
--
-- WHAT HAPPENED. CBFW's hand-set period 2026-11-02 -> 11-16 was built under
-- version 10 at 11-16 00:40Z, eighty minutes before it closed: three members
-- 48 hours or more offline, graded R1 for it. Rebuilt under version 11 at
-- 11-18 14:49Z, the same period had NOBODY offline. Nobody had come back for
-- the period; the scorer had stopped being able to see it.
--
-- WHY. The offline figure came from `player_presence`, which is one row per
-- player holding the NEWEST presence (0024, written by 0032's roster trigger),
-- joined with `observed_at <= measured_to`. While a period runs, measured_to
-- is now() and that row is the answer. Once the period has ended, measured_to
-- is the period's end, and the roster is swept several times a day - so within
-- hours of the close every member's row has been overwritten by a sighting
-- AFTER the end, the bound rejects it, and offline_hours is null for everyone.
-- A null is "not known to be away", so every offline R1 silently became a
-- scored member. The row did not hold the history the bound was asking it for.
--
-- THE FIX. Read the presence the same way the trigger derives it - the newest
-- roster snapshot of the player that is not presence-redacted and carries an
-- online state - but at or before measured_to, from `alliance_member_snapshots`,
-- which keeps every sighting. For a period still running this is exactly the
-- row `player_presence` holds (newest, newer-wins), so a build mid-period is
-- unchanged; for a finished one it is the sighting at the close, whenever the
-- rebuild happens. Same probe count as before: one index probe per member on
-- (player_id, captured_at desc) replaces one primary-key probe on
-- player_presence.
--
-- Scoring version 12: a finished period rebuilt now gets its offline members
-- back, so it does not reproduce its version-11 rows (0071). The old rows stay.
--
-- WHAT THIS DOES NOT TOUCH. Who is scored is still today's roster
-- (`alliance_roster_latest`), and the rank_tiers settings are still read at
-- build time; both can move a finished period's answer when it is rebuilt.
-- Neither is this migration's subject. Nor is retention: an own alliance's
-- roster history is kept three months (0299), so a period older than that,
-- rebuilt, finds the sighting at its end purged and reads "not known" for
-- everybody - which is what every rebuild after the close read until now.

-- The scorer, as 0329 left it, with presence read from the roster history.
-- Scoring version 12.
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
  -- Set by hand (0316)? Only then is a member who joined mid-period scored
  -- at all (0329).
  v_overridden boolean;
  -- The reset that opens the period's LAST week. A member first seen at or
  -- before it has at least one whole week on the roster.
  v_last_week_opens timestamptz;
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
  select b.period_start, b.period_end, b.overridden into v_bounds
  from public.rank_period_bounds(p_period_start, v_alliance) b;
  if v_bounds.period_start <> p_period_start then
    raise exception 'not the start of a rank period: the period containing % starts at %',
      p_period_start, v_bounds.period_start
      using errcode = '22023';
  end if;
  v_period_end := v_bounds.period_end;
  v_overridden := coalesce(v_bounds.overridden, false);
  week_ends := public.rank_period_reading_ends(p_period_start, v_period_end);
  v_last_week_opens := p_period_start + ((cardinality(week_ends) - 1) * interval '7 days');
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
      mr.member_rank, sn.first_seen, rs.roster_first_seen,
      nc.newcomer,
      -- PRORATED (0329): joined during a hand-set period, with at least one
      -- whole week on the roster. Scored over the share of the period from
      -- the first sighting to the end; everybody else's share is 1.
      nc.prorated,
      case when nc.prorated then sn.first_seen else p_period_start end as present_from,
      case when nc.prorated
           then extract(epoch from v_period_end - sn.first_seen)
                / extract(epoch from v_period_end - p_period_start)
           else 1 end as measured_share
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
    -- Joined DURING this period (0072's rule, 0164's bound): first seen after
    -- the start, and after the alliance's own first roster capture, so a
    -- member present at the very first sweep is not a newcomer.
    cross join lateral (
      select
        (sn.first_seen is not null
          and sn.first_seen > p_period_start
          and sn.first_seen > rs.roster_first_seen) as newcomer,
        (v_overridden
          and sn.first_seen is not null
          and sn.first_seen > p_period_start
          and sn.first_seen > rs.roster_first_seen
          and sn.first_seen <= v_last_week_opens) as prorated
    ) nc
    where r.alliance_id = (select alliance_id from own_alliance)
  ),
  -- ONE WINDOW PER WEEK THE PERIOD HAS (0316), not two assumed. Each week
  -- opens at the RESET (0309), not at the previous week's reading: a capture
  -- taken between a deadline and the reset belongs to neither.
  reading as (
    -- A week that opened before the member was on the roster is a PARTIAL
    -- week for them (0329): read into the sums, not held to the minimum.
    select m.player_id, w.idx, t.kind, c.score, c.captured_at,
      (w.opens >= m.present_from) as whole_week
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
      bool_or(kind = 'weekly_donation' and score < min_donation and whole_week) as donation_under,
      bool_or(kind = 'alliance_battle_weekly' and score < min_duel and whole_week) as duel_under
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
      -- Not a day before the member was on the roster (0329).
      and d.day_start >= m.present_from
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
      m.newcomer, m.prorated, m.measured_share,
      c.donation_week1, c.donation_week1_at, c.donation_week2, c.donation_week2_at,
      c.duel_week1, c.duel_week1_at, c.duel_week2, c.duel_week2_at,
      case when coalesce(c.donation_reads, 0) = 0 then null else c.donation_sum end
        as donation_total,
      -- THE FIGURE THE DONATION WEIGHT RANKS (0329): the total over the share
      -- of the period the member was there for. Equal to the total for a
      -- share of 1, which is everybody outside a hand-set period.
      case when coalesce(c.donation_reads, 0) = 0 then null
           else c.donation_sum / m.measured_share end as donation_figure,
      case when coalesce(c.duel_reads, 0) = 0 then null else c.duel_sum end
        as duel_total,
      -- Null in points mode and for a member with no daily reading at all;
      -- a left join with no match is exactly that null.
      dd.days_met as duel_days_met,
      dd.days_read as duel_days_read,
      -- THE FIGURE THE DUEL WEIGHT RANKS. The weekly points, or under 'days'
      -- the count of days met. Everything downstream compares this and never
      -- duel_total directly, so the two modes share one percentile. Over the
      -- member's share of the period, like the donation figure (0329).
      case
        when duel_mode = 'days' then dd.days_met::numeric
        when coalesce(c.duel_reads, 0) = 0 then null
        else c.duel_sum::numeric
      end / m.measured_share as duel_figure,
      coalesce(c.donation_under, false) as donation_under,
      coalesce(c.duel_under, false) as duel_under,
      ps.power as power_start, ps.captured_at as power_start_at,
      pe.power as power_end, pe.captured_at as power_end_at,
      case when ps.power is null or ps.power = 0 or pe.power is null then null
           else (pe.power - ps.power)::numeric / ps.power * 100 end as power_growth,
      -- No sighting with a presence at or before measured_to is "not known",
      -- never "away": null, which the grading below does not demote (0335).
      case
        when pr.online_state is null then null
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
    -- PRESENCE AS IT STOOD AT measured_to (0335), from the roster history and
    -- not from `player_presence`, which holds only the newest sighting and so
    -- has nothing at or before the end of a period that has closed. The
    -- filter is the one 0032's trigger projects `player_presence` with - any
    -- alliance's roster, skipping a redacted one and one with no state - so
    -- while the period runs this is that table's own row.
    left join lateral (
      select s.online_state, s.offline_since
      from public.alliance_member_snapshots s
      where s.player_id = m.player_id
        and not s.presence_redacted
        and s.online_state is not null
        and s.captured_at <= measured_to
      order by s.captured_at desc
      limit 1
    ) pr on true
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
      -- contribution — which is the reason 0072 gave, in 0072's own words
      -- (the bound is 0164's; the rule itself is computed in `members`).
      -- Unless the period was set by hand and they have a whole week on the
      -- roster, in which case they are prorated instead (0329).
      (newcomer and not prorated) as unmeasured
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
          (select 100.0 * count(*) filter (where p.donation_figure < c.donation_figure)
                  / nullif(count(*) - 1, 0)
           from pool p)
        else
          (select 100.0 * count(*) filter (where p.donation_figure < c.donation_figure)
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
        when donation_figure is null and duel_figure is null and power_growth is null then null
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
    duel_days_met, duel_days_read, duel_scoring, measured_share)
  select
    p_period_start, v_period_end, player_id, game_uid, current_name, 12,
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
      when prorated then 'score, over the ' || round(measured_share * 100)
        || '% of the period on the roster'
      else 'score'
    end,
    below_minimum,
    minimum_missed,
    lab_level,
    lab_adjustment,
    v_alliance,
    duel_days_met,
    duel_days_read,
    duel_mode,
    measured_share
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
    measured_share = excluded.measured_share,
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
  'In a hand-set period a member who joined with a whole week still to run is '
  'scored over their share of it, both figures divided by measured_share '
  '(0329); on the grid they stay unmeasured. Offline hours come from the '
  'newest roster sighting with a presence at or before the period''s end (or '
  'now, while it runs), so a finished period rebuilt later keeps its absences '
  '(0335). Every per-member figure is an index probe (0110). Officer and up '
  '(0112). Scoring version 12.';
