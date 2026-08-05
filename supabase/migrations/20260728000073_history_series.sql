-- 0073: the series behind the charts.
--
-- Everything the analysis screens want is already in the snapshot tables. What
-- is missing is the shape: a browser asking "how has our power moved" against
-- `alliance_member_snapshots` downloads 2,433 rows to draw 20 points, and one
-- asking the same of every alliance on the server cannot.
--
-- So these are aggregates and projections, computed where the rows are. None of
-- them adds a fact; each one removes work.
--
-- WHAT IS ACTUALLY THERE, counted on the live database rather than assumed —
-- because a chart of two points is worse than a sentence, and the screens are
-- written knowing which of these is dense and which is sparse:
--
--   alliance_snapshots        2,675 rows · 162 alliances · 221 of them on 580,
--                             where 12 of 40 alliances have more than one reading
--   player_snapshots          2,345 rows · 373 players · 247 with >1 reading
--   alliance_member_snapshots 2,433 rows for OUR alliance across 26 batches, of
--                             which 20 saw all 94 members and 6 stopped early
--   rank_period_snapshots       475 rows · 5 periods scored
--
-- All of it starts 2026-07-28, when the collector first ran against the cloud.
-- Anything reading these must treat a short series as normal — and must not
-- treat a SHORT BATCH as a departure, which is what `snapshot_complete` is for.

-- Every alliance's power, rank and size over time, for any signed-in reader.
--
-- security_invoker, and no gate written in: `alliance_snapshots` carries
-- `public_read using (true)` from 0006 and 0065 revoked anon at the grant, so
-- the caller's own rights already decide this — 0055's correction, applied
-- rather than repeated. The name is joined on because a chart legend needs it
-- and the alternative is a second query per line.
create view public.alliance_power_history
with (security_invoker = true) as
select
  s.alliance_id,
  s.server_id,
  s.captured_at,
  s.power,
  s.rank,
  s.member_count,
  a.current_name as name,
  a.current_code as code,
  a.is_own
from public.alliance_snapshots s
join public.alliances a on a.alliance_id = s.alliance_id;

comment on view public.alliance_power_history is
  'One row per alliance ranking capture: power, rank and member count over '
  'time, with the alliance name for a legend. Sparse by nature — the boards '
  'are captured when somebody opens them, roughly a dozen times so far.';

grant select on public.alliance_power_history to authenticated;

-- Who is growing, in one row each.
--
-- The question this answers is not "what is their power" — the ranking table
-- already says that — but "who is pulling away", which needs two readings and a
-- span. Every figure carries the span it was measured over, for the same reason
-- player_growth_recent does: with a dozen irregular captures per alliance, a
-- percentage without its interval is a number nobody can compare.
--
-- Alliances with one reading are kept, with null growth. Dropping them would
-- quietly answer a different question — "alliances we have looked at twice" —
-- and the reader would have no way to notice the omission.
create view public.alliance_growth as
with bounds as (
  select
    alliance_id,
    min(captured_at) as first_at,
    max(captured_at) as last_at,
    count(*) as readings
  from public.alliance_snapshots
  where power is not null
  group by alliance_id
),
edges as (
  select
    b.alliance_id,
    b.first_at,
    b.last_at,
    b.readings,
    (select s.power from public.alliance_snapshots s
      where s.alliance_id = b.alliance_id and s.captured_at = b.first_at
      order by s.power desc limit 1) as power_first,
    (select s.power from public.alliance_snapshots s
      where s.alliance_id = b.alliance_id and s.captured_at = b.last_at
      order by s.power desc limit 1) as power_last,
    (select s.rank from public.alliance_snapshots s
      where s.alliance_id = b.alliance_id and s.captured_at = b.first_at
      order by s.power desc limit 1) as rank_first,
    (select s.rank from public.alliance_snapshots s
      where s.alliance_id = b.alliance_id and s.captured_at = b.last_at
      order by s.power desc limit 1) as rank_last
  from bounds b
)
select
  e.alliance_id,
  a.server_id,
  a.current_name as name,
  a.current_code as code,
  a.is_own,
  a.member_count,
  e.readings,
  e.first_at,
  e.last_at,
  e.power_first,
  e.power_last,
  -- Null rather than zero when there is only one reading: an alliance we have
  -- seen once has not been measured as flat, it has not been measured.
  case when e.readings > 1 then e.power_last - e.power_first end as power_growth,
  case
    when e.readings > 1 and e.power_first > 0
      then round(((e.power_last - e.power_first)::numeric / e.power_first) * 100, 2)
  end as power_growth_pct,
  -- Rank falling is improvement, so this is signed the way a reader expects:
  -- positive means they climbed. Getting this backwards is the kind of thing
  -- nobody notices until a decision is made on it.
  case when e.readings > 1 then e.rank_first - e.rank_last end as rank_climb,
  e.rank_first,
  e.rank_last,
  extract(epoch from (e.last_at - e.first_at)) / 86400.0 as span_days
from edges e
join public.alliances a on a.alliance_id = e.alliance_id;

comment on view public.alliance_growth is
  'Per alliance: power and rank at the first and last capture, the change '
  'between them, and the span it was measured over. Null growth means one '
  'reading — unmeasured, not flat. rank_climb is positive for climbing.';

grant select on public.alliance_growth to authenticated;

-- Our own alliance, batch by batch, as aggregates.
--
-- DEFINER and gated, for 0067's reason exactly. 0066 narrowed
-- `alliance_member_snapshots` to officers and the caller's own linked player
-- because it is a member's HISTORY, one row per capture. This asks a different
-- question — what did the alliance look like at each roster read — and the
-- answer is aggregate: no member is named, no row is per person, nothing here
-- identifies who was strong or who was idle. An invoker view would give an
-- ordinary member a chart of one person: themselves.
--
-- Every row of an `al.rank` response shares its `captured_at`, so grouping on
-- it IS grouping by capture. `snapshot_complete` is 0067's rule repeated rather
-- than re-derived differently: a batch smaller than the game's own member count
-- was cut short, and averaging a half-scrolled capture next to a whole one puts
-- a step in the chart that nothing in the alliance caused.
create view public.alliance_roster_history as
select
  s.alliance_id,
  s.captured_at,
  count(*) as observed_members,
  a.member_count as expected_members,
  (a.member_count is null or count(*) >= a.member_count) as snapshot_complete,
  sum(s.power) as total_power,
  round(avg(s.power)) as avg_power,
  percentile_cont(0.5) within group (order by s.power) as median_power,
  max(s.power) as max_power,
  round(avg(s.hq_level)::numeric, 2) as avg_hq_level,
  max(s.hq_level) as max_hq_level,
  -- Counted rather than averaged: "how many are at the cap" is the question an
  -- officer actually asks about tower levels, and a mean hides it.
  count(*) filter (where s.hq_level >= 35) as members_at_hq35,
  sum(s.kills) as total_kills,
  count(*) filter (where s.member_rank >= 4) as officers,
  count(*) filter (where s.presence_redacted) as presence_unknown
from public.alliance_member_snapshots s
join public.alliances a on a.alliance_id = s.alliance_id
where public.current_app_role() in ('member', 'officer', 'admin')
group by s.alliance_id, s.captured_at, a.member_count;

comment on view public.alliance_roster_history is
  'One row per roster capture: size, power and tower-level aggregates for the '
  'alliance as a whole. Aggregate only — no member is named, which is why it '
  'is readable by members while the table underneath is not. Incomplete '
  'batches are flagged rather than dropped.';

grant select on public.alliance_roster_history to authenticated;

-- One player's readings over time, for anybody signed in.
--
-- The player page has shown deltas against fixed baselines (0049) and against
-- the previous reading (0069). Neither gives the SHAPE, and shape is the
-- question for somebody outside our alliance: they are captured when a profile
-- is opened, so their series is a handful of irregular points and a single
-- percentage cannot say whether they are climbing steadily or jumped once.
--
-- `player_snapshots`, not `alliance_member_snapshots`: the first is
-- `public_read` and covers every player the ranking boards have ever listed,
-- which is the whole point — our own members already have the roster history
-- screen. security_invoker so this can never outrun its caller.
create view public.player_power_history
with (security_invoker = true) as
select
  player_id,
  server_id,
  captured_at,
  power,
  hq_level,
  kills,
  rank,
  source_command
from public.player_snapshots;

comment on view public.player_power_history is
  'One row per ranking-board sighting of a player: power, tower level, kills '
  'and board rank over time. Covers everybody, not only our members — sparse '
  'and irregular for outsiders, because a capture happens when somebody looks.';

grant select on public.player_power_history to authenticated;
