-- 0098: the growth views read the whole table however few players you ask for.
--
-- Reported as `canceling statement due to statement timeout` on the members
-- screen, and every page taking five seconds or more.
--
-- WHAT WAS WRONG. `player_power_growth` (0049, amended by 0051) built three
-- CTEs — latest, daily, weekly — and `latest` was referenced by the other two.
-- A CTE referenced more than once is materialised, so the caller's
-- `player_id = any(...)` could not be pushed into the scans underneath it.
-- The plan said so plainly: `Hash Semi Join (actual rows=6)` sitting on top of
-- `Merge Left Join (actual rows=7150)`, over three `Seq Scan`s of the whole
-- table. The dashboard asked for 94 members and the database answered for
-- 7,150 players, three times, with `player_snapshots_player_captured_idx`
-- unused because a full sort was cheaper than an index walk of everything.
--
-- `player_growth_recent` (0069) had the identical shape: one `ranked` CTE
-- joined to itself for position 1 and position 2.
--
-- Both are rewritten as ONE pass, no CTE, grouped by player_id, picking the
-- rows out with `(array_agg(... order by captured_at desc))[n]`. Nothing is
-- referenced twice, so the qual reaches the scan and the index is used.
--
-- THE NUMBERS, measured locally against a copy of production's shape (7,643
-- players, 35,301 snapshots; production had 7,514 and 38,207), filtering to 94
-- members exactly as PostgREST sends it:
--
--   player_power_growth    44.3 ms -> 0.24 ms
--   player_growth_recent   32.4 ms -> 0.59 ms
--   player_power_history   44.5 ms -> 0.12 ms   (with the new index)
--
-- Production is slower than this box and adds RLS on top, which is how 44 ms
-- became a timeout. The shape is the point rather than the milliseconds: what
-- changed is that the work is now proportional to the number of players asked
-- for, not to the number of players that exist.
--
-- OUTPUT IS UNCHANGED. Each rewrite was diffed against the view it replaces
-- over the full 7,150-row result, every column, both directions: zero rows of
-- difference. 29_growth_test and 38_directory_and_growth_test pin the
-- semantics and stay green.

-- `latest` and `daily`/`weekly` in one pass. The `captured_at < latest_at`
-- rule from 0049 is preserved by comparing against the window max rather than
-- by joining to a second copy of the table — that join was the materialised
-- reference.
create or replace view public.player_power_growth
with (security_invoker = true) as
with anchor as (
  -- 0051: the day boundary is 02:05 UTC, not midnight.
  select ((date_trunc('day', (now() at time zone 'UTC') - interval '02:05')
           + interval '02:05') at time zone 'UTC') as at
),
ranked as (
  select
    s.player_id,
    s.power,
    s.captured_at,
    a.at as anchor_at,
    max(s.captured_at) over (partition by s.player_id) as latest_at
  from public.player_snapshots s
  cross join anchor a
  where s.player_id is not null
    and s.power is not null
    and s.captured_at <= a.at
)
select
  r.player_id,
  (array_agg(r.power order by r.captured_at desc))[1] as power,
  max(r.captured_at) as power_at,
  (array_agg(r.power order by r.captured_at desc)
     filter (where r.captured_at <= r.anchor_at - interval '1 day'
               and r.captured_at < r.latest_at))[1] as power_1d,
  max(r.captured_at) filter (where r.captured_at <= r.anchor_at - interval '1 day'
                               and r.captured_at < r.latest_at) as power_1d_at,
  (array_agg(r.power order by r.captured_at desc)
     filter (where r.captured_at <= r.anchor_at - interval '7 days'
               and r.captured_at < r.latest_at))[1] as power_7d,
  max(r.captured_at) filter (where r.captured_at <= r.anchor_at - interval '7 days'
                               and r.captured_at < r.latest_at) as power_7d_at,
  -- Null rather than zero when there is nothing to compare against: FR-UI-008
  -- says an unknown must not wear a real value, and 0049 caught 150 of 150
  -- members reading 0.00% for exactly that reason.
  case
    when (array_agg(r.power order by r.captured_at desc)
            filter (where r.captured_at <= r.anchor_at - interval '1 day'
                      and r.captured_at < r.latest_at))[1] is null
      or (array_agg(r.power order by r.captured_at desc)
            filter (where r.captured_at <= r.anchor_at - interval '1 day'
                      and r.captured_at < r.latest_at))[1] = 0 then null::numeric
    else ((array_agg(r.power order by r.captured_at desc))[1]
          - (array_agg(r.power order by r.captured_at desc)
               filter (where r.captured_at <= r.anchor_at - interval '1 day'
                         and r.captured_at < r.latest_at))[1])::numeric
         / (array_agg(r.power order by r.captured_at desc)
              filter (where r.captured_at <= r.anchor_at - interval '1 day'
                        and r.captured_at < r.latest_at))[1]::numeric * 100
  end as growth_1d,
  case
    when (array_agg(r.power order by r.captured_at desc)
            filter (where r.captured_at <= r.anchor_at - interval '7 days'
                      and r.captured_at < r.latest_at))[1] is null
      or (array_agg(r.power order by r.captured_at desc)
            filter (where r.captured_at <= r.anchor_at - interval '7 days'
                      and r.captured_at < r.latest_at))[1] = 0 then null::numeric
    else ((array_agg(r.power order by r.captured_at desc))[1]
          - (array_agg(r.power order by r.captured_at desc)
               filter (where r.captured_at <= r.anchor_at - interval '7 days'
                         and r.captured_at < r.latest_at))[1])::numeric
         / (array_agg(r.power order by r.captured_at desc)
              filter (where r.captured_at <= r.anchor_at - interval '7 days'
                        and r.captured_at < r.latest_at))[1]::numeric * 100
  end as growth_7d
from ranked r
group by r.player_id;

comment on view public.player_power_growth is
  'Day-over-day and week-over-week power per player, against the 02:05 UTC '
  'anchor. One pass over player_snapshots so a filtered read touches only the '
  'players asked for — see 0098 before reintroducing a CTE here.';

-- Same disease, same cure. `ranked` was joined to itself to get position 2.
create or replace view public.player_growth_recent
with (security_invoker = true) as
select
  s.player_id,
  (array_agg(s.power order by s.captured_at desc))[1] as power,
  max(s.captured_at) as power_at,
  (array_agg(s.power order by s.captured_at desc))[2] as power_prev,
  (array_agg(s.captured_at order by s.captured_at desc))[2] as power_prev_at,
  max(s.captured_at) - (array_agg(s.captured_at order by s.captured_at desc))[2] as span,
  case
    when (array_agg(s.power order by s.captured_at desc))[2] is null
      or (array_agg(s.power order by s.captured_at desc))[2] = 0 then null::numeric
    else ((array_agg(s.power order by s.captured_at desc))[1]
          - (array_agg(s.power order by s.captured_at desc))[2])::numeric
         / (array_agg(s.power order by s.captured_at desc))[2]::numeric * 100
  end as growth_since_last
from public.player_snapshots s
where s.player_id is not null and s.power is not null
group by s.player_id;

comment on view public.player_growth_recent is
  'Each player against their own previous reading, whatever the interval, with '
  'that reading''s timestamp so a screen can say what it measured from. One '
  'pass — see 0098.';

-- A different reason for the same symptom, and it needed a different fix.
--
-- `board_size` counts the rows sharing an observation_id, so it is a question
-- about OTHER players' rows. A window partitioned by observation_id therefore
-- cannot have a player_id filter pushed under it without changing the answer —
-- Postgres was right to refuse. Asking per row as a scalar subquery lets the
-- outer filter reach the scan, and the count becomes an index lookup.
create or replace view public.player_power_history
with (security_invoker = true) as
select
  s.player_id,
  s.server_id,
  s.captured_at,
  s.power,
  s.hq_level,
  s.kills,
  s.rank,
  s.source_command,
  (select count(*) from public.player_snapshots b
    where b.observation_id = s.observation_id) as board_size
from public.player_snapshots s;

comment on view public.player_power_history is
  'One row per player_snapshot with the size of the board it came from. '
  'board_size is a scalar subquery rather than a window so that filtering by '
  'player reaches the scan — see 0098.';

-- What makes that subquery cheap. Without it the rewrite is 2.24 ms instead
-- of 0.12 ms — better than the 44.5 ms it replaces either way, but there is no
-- reason to leave it half done.
create index if not exists player_snapshots_observation_idx
  on public.player_snapshots (observation_id);
