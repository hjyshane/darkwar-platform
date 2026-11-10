-- 0315: a rank period set by hand.
--
-- Rank periods have been a fixed grid since 0050: every other Monday 02:00 UTC
-- from the 2026-08-03 epoch, two weeks each, no exceptions. The grid is the
-- right default — the alliance reviews ranks that often and the phase was its
-- own choice (0071) — but it has no room for the things that actually break a
-- fortnight. A new season opens on a Monday the grid does not know about. A
-- server migration empties the boards for a week. The alliance wants the next
-- review to start WITH the season, not six days into it. Until now the only way
-- to do that was to edit the epoch, which moves every boundary in history.
--
-- So an officer can now set a period by hand: a start and an end, both on the
-- game's own Monday 02:00 UTC reset, one to four weeks apart. Everything that
-- used to ask the grid now asks `rank_period_bounds`, which answers in this
-- order:
--
--   1. Inside a hand-set period: that period, exactly as entered.
--   2. Otherwise, fortnights — counted from the END of the newest hand-set
--      period that has finished, or from the 2026-08-03 epoch grid before any
--      exists. A hand-set period RE-ANCHORS the grid: after a three-week period
--      ending on the 7th, the next review runs the 7th to the 21st, and every
--      other Monday from there.
--   3. The fortnight running up to a hand-set period is CUT SHORT where that
--      period begins, so no instant belongs to two periods and none to none.
--
-- The rule is in SQL only. The dashboard used to carry its own copy of the
-- grid, checked against shared vectors; now that the answer depends on a table,
-- a second copy would have to fetch the table and re-implement the three steps
-- above, and that is exactly the kind of duplicate that drifts. The screen asks
-- `recent_rank_periods` and prints what it is told.
--
-- WHAT A HAND-SET PERIOD CHANGES IN THE SCORER. `build_rank_period` took two
-- weeks as a fact: two readings, two window columns, a total that was week one
-- plus week two. It now takes the period's own bounds, reads every Sunday 14:00Z
-- inside them, and sums every week that was read. The snapshot keeps its
-- `donation_week1`/`week2` columns for the first two readings — they are what
-- the report prints and what the minimums were written against — and gains
-- `period_end`, so a period's length is recorded with its answer rather than
-- re-derived from a table that may have changed since. For a two-week period
-- every figure is identical to 0309's, which is why this stays scoring version
-- 9: a different length is a different INPUT, not a different rule, and the
-- version exists to tell rules apart (0071).
--
-- A period that was built and whose bounds are then changed by hand keeps its
-- rows under the old start. The screen will no longer offer that start, because
-- it is no longer a period start; rebuild under the new bounds and the old rows
-- stay as history (never overwrite historical scores). Deleting a hand-set
-- period after building under it has the same shape: the old start stops being
-- offered until the period is set again. `build_rank_period` refuses a start
-- that is not a period start under the current rule rather than guess an end.
--
-- Written only through `save_rank_period_override` / `delete_rank_period_override`,
-- gated on settings.write like the rank tier settings they sit beside (0200), and
-- scoped to the alliance being viewed (0193) like every other derived table.

-- ---------------------------------------------------------------------------
-- The table.

create table public.rank_period_overrides (
  override_id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references public.alliances (alliance_id) on delete cascade
    default public.active_alliance(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  note text check (note is null or length(btrim(note)) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  -- Both ends on the game's weekly reset, so the Sunday readings inside the
  -- period land twelve hours before a board the game actually clears.
  constraint rank_period_overrides_start_on_a_reset
    check (period_start = public.reset_week_start(period_start)),
  constraint rank_period_overrides_end_on_a_reset
    check (period_end = public.reset_week_start(period_end)),
  -- One to four weeks. A longer review is a different thing from a rank period.
  constraint rank_period_overrides_one_to_four_weeks
    check (period_end > period_start and period_end <= period_start + interval '4 weeks'),
  unique (alliance_id, period_start)
);

comment on table public.rank_period_overrides is
  'Rank periods set by hand (0315), one row per period, per alliance. Both ends '
  'are Monday 02:00 UTC resets, one to four weeks apart, never overlapping. '
  'rank_period_bounds answers from here first and from the fortnightly grid '
  'otherwise, re-anchored at the newest finished hand-set period. Written only '
  'through save_rank_period_override / delete_rank_period_override.';

alter table public.rank_period_overrides enable row level security;
-- Hosted projects hand new tables to authenticated with every privilege (0185).
revoke all on public.rank_period_overrides from public, anon, authenticated;
grant select on public.rank_period_overrides to authenticated;
grant all on public.rank_period_overrides to service_role;

create policy member_read on public.rank_period_overrides
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

-- The alliance being viewed, and no other (0196's shape).
create policy alliance_scope on public.rank_period_overrides as restrictive
  for all to authenticated
  using (alliance_id is not distinct from (select public.active_alliance()))
  with check (alliance_id is not distinct from (select public.active_alliance()));

-- ---------------------------------------------------------------------------
-- The rule.

create function public.rank_period_bounds(
  ts timestamptz,
  p_alliance uuid default public.active_alliance()
)
returns table (period_start timestamptz, period_end timestamptz, overridden boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_anchor timestamptz;
  v_next timestamptz;
  v_week timestamptz := public.reset_week_start(ts);
begin
  -- 1. Inside a hand-set period: that period.
  select o.period_start, o.period_end into v_start, v_end
  from public.rank_period_overrides o
  where o.alliance_id = p_alliance
    and o.period_start <= ts
    and ts < o.period_end;
  if found then
    return query select v_start, v_end, true;
    return;
  end if;

  -- 2. Fortnights, counted from the newest hand-set period that has ended —
  -- or, before any exists, from the epoch grid rank_period_start has always
  -- answered with. The anchor is a reset and so is v_week, so the difference
  -- is a whole number of weeks and the floor takes an even number of them.
  select max(o.period_end) into v_anchor
  from public.rank_period_overrides o
  where o.alliance_id = p_alliance
    and o.period_end <= ts;
  if v_anchor is null then
    v_start := public.rank_period_start(ts);
  else
    v_start := v_anchor
      + floor(extract(epoch from (v_week - v_anchor)) / 1209600)::int * interval '2 weeks';
  end if;

  -- 3. Cut short where the next hand-set period begins. That start is a reset
  -- after ts, so it is after v_week and the period keeps at least one week.
  select min(o.period_start) into v_next
  from public.rank_period_overrides o
  where o.alliance_id = p_alliance
    and o.period_start > ts;
  v_end := least(v_start + interval '2 weeks', v_next);

  return query select v_start, v_end, false;
end;
$$;

comment on function public.rank_period_bounds(timestamptz, uuid) is
  'The rank period containing ts for one alliance (0315): a hand-set period if '
  'one covers ts; otherwise a fortnight counted from the end of the newest '
  'finished hand-set period (or the 2026-08-03 grid before any), cut short where '
  'the next hand-set period begins. The one place the rule lives.';

revoke all on function public.rank_period_bounds(timestamptz, uuid) from public, anon;
grant execute on function public.rank_period_bounds(timestamptz, uuid)
  to authenticated, service_role;

-- The Sunday 14:00Z readings inside a period of any whole number of weeks:
-- twelve hours before each reset the period contains, the period's own end
-- included (0309). rank_period_week_ends(period_start) keeps answering for a
-- fortnight; this is the same answer for any length.
create function public.rank_period_reading_ends(period_start timestamptz, period_end timestamptz)
returns timestamptz[]
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    array_agg(period_start + (n * interval '7 days') - interval '12 hours' order by n),
    '{}'::timestamptz[])
  from generate_series(
    1, floor(extract(epoch from (period_end - period_start)) / 604800)::int) as n
$$;

comment on function public.rank_period_reading_ends(timestamptz, timestamptz) is
  'Sunday 14:00Z of each week in [period_start, period_end): the moments the '
  'weekly boards are read, twelve hours before the game clears them (0309). One '
  'entry per whole week; a four-week period has four.';

revoke all on function public.rank_period_reading_ends(timestamptz, timestamptz) from public, anon;
grant execute on function public.rank_period_reading_ends(timestamptz, timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The period's end travels with its answer.

alter table public.rank_period_snapshots add column period_end timestamptz;

comment on column public.rank_period_snapshots.period_end is
  'When this period ended (0315) — the next period''s start. Two weeks after '
  'period_start for every period built before hand-set periods existed; the '
  'bounds in force at build time since. Null only on rows older than this '
  'column, which readers treat as a fortnight.';

update public.rank_period_snapshots
set period_end = period_start + interval '14 days'
where period_end is null;

-- THE STAR IS FROZEN AT CREATION (0160, 0163): the view has to be re-created
-- to see the new column.
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
-- The scorer, as 0309 wrote it, reading the period's own bounds.

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
  -- The alliance being built: the one being viewed (0193). One alliance
  -- per call, never a loop over all of them - 0110 measured this function
  -- at the edge of the statement timeout for one.
  v_alliance uuid := public.active_alliance();
begin
  -- Officer and up (0112).
  if public.current_app_role() not in ('officer', 'admin') then
    raise exception 'officers only' using errcode = '42501';
  end if;

  -- THE PERIOD'S OWN BOUNDS (0315), not two weeks assumed. A start that is not
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
  -- ONE WINDOW PER WEEK THE PERIOD HAS (0315), not two assumed. Each week
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
    lab_level, lab_adjustment, alliance_id)
  select
    p_period_start, v_period_end, player_id, game_uid, current_name, 9,
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
    v_alliance
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
    computed_at = now();

  get diagnostics written = row_count;
  return written;
end;
$$;

comment on function public.build_rank_period(timestamptz) is
  'Scores one rank period for the alliance being viewed (0196) with its own '
  'rank_tiers, and writes rank_period_snapshots with alliance_id and the '
  'period''s end. The period''s bounds come from rank_period_bounds (0315): a '
  'start that is not a period start is refused. One Sunday 14:00Z reading per '
  'week the period has; week1/week2 columns hold the first two, the totals '
  'every week read. Every per-member figure is an index probe (0110). Officer '
  'and up (0112). Scoring version 9 (0309) — a two-week period scores exactly '
  'as before; a different length is a different input, not a different rule.';

-- ---------------------------------------------------------------------------
-- The views that asked "has the fortnight ended?" now ask the period.
-- 0132's movement and 0275's preview, unchanged but for the bound; a row
-- older than the column is still a fortnight.

create or replace view public.rank_period_movement
with (security_invoker = true) as
with newest as materialized (
  -- The newest FINISHED period, and the version it was built under.
  select period_start, scoring_version
  from public.rank_period_snapshots
  where coalesce(period_end, period_start + interval '2 weeks') <= now()
  order by period_start desc, scoring_version desc
  limit 1
),
prior as materialized (
  select s.period_start
  from public.rank_period_snapshots s, newest n
  where s.period_start < n.period_start
    and s.scoring_version = n.scoring_version
  order by s.period_start desc
  limit 1
),
latest as materialized (
  select s.*
  from public.rank_period_snapshots s, newest n
  where s.period_start = n.period_start and s.scoring_version = n.scoring_version
),
previous as materialized (
  select s.*
  from public.rank_period_snapshots s, newest n, prior p
  where s.period_start = p.period_start and s.scoring_version = n.scoring_version
)
select
  latest.player_id,
  latest.name,
  latest.period_start,
  previous.period_start as previous_period_start,
  latest.tier,
  previous.tier as previous_tier,
  latest.activity_score,
  previous.activity_score as previous_activity_score,
  latest.tier_reason,
  case
    when latest.tier is null or previous.tier is null then null
    else public.tier_rank(latest.tier) - public.tier_rank(previous.tier)
  end as tier_change,
  case
    when latest.activity_score is null or previous.activity_score is null then null
    else latest.activity_score - previous.activity_score
  end as score_change
from latest
left join previous on previous.player_id = latest.player_id;

create or replace view public.rank_period_movement_preview
with (security_invoker = true) as
with newest as materialized (
  select period_start, scoring_version
  from public.rank_period_snapshots
  where coalesce(period_end, period_start + interval '2 weeks') > now()
  order by period_start desc, scoring_version desc
  limit 1
),
prior as materialized (
  select s.period_start
  from public.rank_period_snapshots s, newest n
  where s.period_start < n.period_start
    and s.scoring_version = n.scoring_version
  order by s.period_start desc
  limit 1
),
latest as materialized (
  select s.*
  from public.rank_period_snapshots s, newest n
  where s.period_start = n.period_start and s.scoring_version = n.scoring_version
),
previous as materialized (
  select s.*
  from public.rank_period_snapshots s, newest n, prior p
  where s.period_start = p.period_start and s.scoring_version = n.scoring_version
)
select
  latest.player_id,
  latest.name,
  latest.period_start,
  previous.period_start as previous_period_start,
  latest.tier,
  previous.tier as previous_tier,
  latest.activity_score,
  previous.activity_score as previous_activity_score,
  latest.tier_reason,
  case
    when latest.tier is null or previous.tier is null then null
    else public.tier_rank(latest.tier) - public.tier_rank(previous.tier)
  end as tier_change,
  case
    when latest.activity_score is null or previous.activity_score is null then null
    else latest.activity_score - previous.activity_score
  end as score_change
from latest
left join previous on previous.player_id = latest.player_id;

-- ---------------------------------------------------------------------------
-- The running period, week by week (0157), on the period now in force.
--
-- The columns 0157 gave it, plus the period's end and its week count. The two
-- week columns are the first two readings; a third or fourth week is in the
-- totals and in `weeks`, which is how the screen knows to say so. One indexed
-- probe per member per week per board, as before.

drop view public.member_current_period_contribution;

create view public.member_current_period_contribution
with (security_invoker = true) as
with period as (
  select
    b.period_start,
    b.period_end,
    e.ends[1] as week1_end,
    e.ends[2] as week2_end,
    cardinality(e.ends) as weeks,
    e.ends
  from public.rank_period_bounds(now()) b
  cross join lateral (
    select public.rank_period_reading_ends(b.period_start, b.period_end) as ends
  ) e
)
select
  r.player_id,
  p.current_name,
  p.game_uid,
  d.period_start,
  d.period_end,
  d.weeks,
  d.week1_end,
  d.week2_end,
  rd.donation_week1,
  rd.donation_week2,
  rd.duel_week1,
  rd.duel_week2,
  -- The period so far. Nothing read stays null: a member with no reading has
  -- not donated nothing, they have not been read.
  case when rd.donation_reads = 0 then null else rd.donation_sum end as donation_total,
  case when rd.duel_reads = 0 then null else rd.duel_sum end as duel_total,
  rd.newest_reading_at
from public.member_roster_current r
join public.players p on p.player_id = r.player_id
cross join period d
cross join lateral (
  select
    max(x.score) filter (where x.kind = 'weekly_donation' and x.idx = 1) as donation_week1,
    max(x.score) filter (where x.kind = 'weekly_donation' and x.idx = 2) as donation_week2,
    max(x.score) filter (where x.kind = 'alliance_battle_weekly' and x.idx = 1) as duel_week1,
    max(x.score) filter (where x.kind = 'alliance_battle_weekly' and x.idx = 2) as duel_week2,
    sum(x.score) filter (where x.kind = 'weekly_donation') as donation_sum,
    count(x.score) filter (where x.kind = 'weekly_donation') as donation_reads,
    sum(x.score) filter (where x.kind = 'alliance_battle_weekly') as duel_sum,
    count(x.score) filter (where x.kind = 'alliance_battle_weekly') as duel_reads,
    max(x.captured_at) as newest_reading_at
  from (
    select w.idx, t.kind, c.score, c.captured_at
    from generate_series(1, d.weeks) as w(idx)
    cross join lateral (values ('weekly_donation'), ('alliance_battle_weekly')) as t(kind)
    left join lateral (
      select s.score, s.captured_at
      from public.alliance_contribution_snapshots s
      where s.game_uid = p.game_uid
        and s.contribution_type = t.kind
        -- Each week opens at the reset (0309): the period's start for week
        -- one, the previous reading plus twelve hours for every week after.
        and s.captured_at > d.period_start + ((w.idx - 1) * interval '7 days')
        and s.captured_at <= d.ends[w.idx]
      order by s.captured_at desc
      limit 1
    ) c on true
  ) x
) rd;

comment on view public.member_current_period_contribution is
  'The RUNNING period''s weekly donation and duel readings per current roster '
  'member. The period is whatever rank_period_bounds says is in force now '
  '(0315) — a hand-set one or the fortnight. week1/week2 are the first two '
  'readings, the totals every week read so far, `weeks` how many the period '
  'has. Raw readings, never a score or a tier: nothing here can move a rank. '
  'One indexed probe per member per week per board (0110).';

revoke all on public.member_current_period_contribution from public, anon, authenticated;
grant select on public.member_current_period_contribution to authenticated;

-- ---------------------------------------------------------------------------
-- What the report screen offers: the period in force and the ones before it.
--
-- Walking back one second at a time off each start, so a hand-set period and
-- the cut-short or re-anchored fortnights around it come out in the order they
-- actually ran. The screen used to compute this list itself from the grid;
-- see the header for why it no longer may.

create function public.recent_rank_periods(p_count int default 6)
returns table (
  period_start timestamptz,
  period_end timestamptz,
  overridden boolean,
  in_progress boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_at timestamptz := now();
  v_alliance uuid := public.active_alliance();
  v_row record;
begin
  for i in 1 .. least(greatest(p_count, 1), 52) loop
    select b.period_start, b.period_end, b.overridden into v_row
    from public.rank_period_bounds(v_at, v_alliance) b;
    period_start := v_row.period_start;
    period_end := v_row.period_end;
    overridden := v_row.overridden;
    in_progress := (i = 1);
    return next;
    v_at := v_row.period_start - interval '1 second';
  end loop;
end;
$$;

comment on function public.recent_rank_periods(int) is
  'The rank period now in force and the p_count - 1 before it, newest first, '
  'for the alliance being viewed (0315). Each is what rank_period_bounds says, '
  'so hand-set periods and the fortnights around them come out as they ran.';

revoke all on function public.recent_rank_periods(int) from public, anon;
grant execute on function public.recent_rank_periods(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Setting one.

create function public.save_rank_period_override(
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
  v_clash record;
  v_id uuid;
begin
  -- The same gate as the rank tier settings this sits beside (0200).
  if not public.has_permission('settings.write') then
    raise exception 'settings.write is needed to set a rank period' using errcode = '42501';
  end if;
  if v_alliance is null then
    raise exception 'no alliance is being viewed' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'a period needs a start and an end' using errcode = '22023';
  end if;
  -- Said in words the constraint would not: the boxes on the screen take any
  -- instant, and "Monday 02:00 UTC" is the sentence that fixes the entry.
  if p_period_start <> public.reset_week_start(p_period_start) then
    raise exception 'a period starts at the weekly reset, Monday 02:00 UTC; % is not one',
      p_period_start using errcode = '22023';
  end if;
  if p_period_end <> public.reset_week_start(p_period_end) then
    raise exception 'a period ends at the weekly reset, Monday 02:00 UTC; % is not one',
      p_period_end using errcode = '22023';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'a period ends after it starts' using errcode = '22023';
  end if;
  if p_period_end > p_period_start + interval '4 weeks' then
    raise exception 'a period is at most four weeks' using errcode = '22023';
  end if;

  -- Two officers setting periods at once is unlikely; two overlapping periods
  -- would be a rule with two answers, so the table is held while this one
  -- checks and writes.
  lock table public.rank_period_overrides in share row exclusive mode;

  select o.period_start, o.period_end into v_clash
  from public.rank_period_overrides o
  where o.alliance_id = v_alliance
    and o.period_start < p_period_end
    and p_period_start < o.period_end
  limit 1;
  if found then
    raise exception 'overlaps the hand-set period % to %', v_clash.period_start, v_clash.period_end
      using errcode = '23505';
  end if;

  insert into public.rank_period_overrides (alliance_id, period_start, period_end, note)
  values (v_alliance, p_period_start, p_period_end, nullif(btrim(p_note), ''))
  returning override_id into v_id;
  return v_id;
end;
$$;

comment on function public.save_rank_period_override(timestamptz, timestamptz, text) is
  'Sets a rank period by hand for the alliance being viewed (0315): both ends '
  'on a Monday 02:00 UTC reset, one to four weeks, not overlapping another. '
  'settings.write (0200). Returns the new row''s id. A period already built '
  'under the old bounds keeps its rows; rebuild it under the new ones.';

revoke all on function public.save_rank_period_override(timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.save_rank_period_override(timestamptz, timestamptz, text)
  to authenticated;

create function public.delete_rank_period_override(p_override_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
begin
  if not public.has_permission('settings.write') then
    raise exception 'settings.write is needed to remove a rank period' using errcode = '42501';
  end if;
  delete from public.rank_period_overrides
  where override_id = p_override_id
    and alliance_id = v_alliance;
  if not found then
    raise exception 'no such hand-set period for this alliance' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.delete_rank_period_override(uuid) is
  'Removes a hand-set rank period of the alliance being viewed (0315); the '
  'fortnightly grid resumes over those weeks. settings.write (0200). Rows '
  'already built under it stay as history.';

revoke all on function public.delete_rank_period_override(uuid) from public, anon;
grant execute on function public.delete_rank_period_override(uuid) to authenticated;
