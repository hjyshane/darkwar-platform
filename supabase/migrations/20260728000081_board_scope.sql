-- 0081: which board a rank came from.
--
-- `alliance_snapshots.rank` was being fed by TWO different boards under one
-- command name, and the trend chart drew both as one line. Our own alliance
-- alternated between rank 1 and rank 7 every three minutes with identical power,
-- which reads as a data fault and is not one: we are 1st on server 580 and 7th
-- across the group, and the routine opens both screens minutes apart.
--
-- Nothing in the payload says which is which — the two responses are identical
-- but for the rank number itself (verified against the captured `raw`). What does
-- distinguish them is the READING they arrived in: a server board lists only that
-- server's alliances (39 rows, all 580), the cross-server board lists the whole
-- group (100 rows spanning 577–588). So the scope is a property of the
-- observation, recovered by counting the servers it covered.
--
-- A VIEW COLUMN RATHER THAN A NEW SNAPSHOT COLUMN. Promoting a typed column is
-- for keys observed consistently in the payload, and this one is not in the
-- payload at all — it is derived. Deriving it in one place beats a column the
-- collector has to guess at write time and can never correct.
--
-- `board_size` comes along because a rank means nothing without it: 7th of 100 is
-- not worse than 1st of 39, and the chart has to be able to say so.
create or replace view public.alliance_power_history
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
  a.is_own,
  case
    -- min <> max rather than count(distinct): Postgres has no DISTINCT inside a
    -- window function, and two different servers in one reading is all this asks.
    when min(s.server_id) over (partition by s.observation_id)
       <> max(s.server_id) over (partition by s.observation_id)
      then 'cross_server'
    else 'server'
  end as board_scope,
  count(*) over (partition by s.observation_id) as board_size
from public.alliance_snapshots s
join public.alliances a on a.alliance_id = s.alliance_id;

comment on view public.alliance_power_history is
  'Every captured ranking-board reading, with which board it was. `board_scope` '
  'is derived from how many servers the reading covered, because the payload '
  'itself is identical between a server board and the cross-server board except '
  'for the rank number — plotting both as one series made our own alliance '
  'appear to swing between 1st and 7th every few minutes.';

-- The same fault, in the column people SORT by.
--
-- `alliance_growth.rank_climb` took the rank at the earliest reading and the rank
-- at the latest one and subtracted. When those two readings came from different
-- boards — which for our own alliance they do every three minutes — the answer
-- was "climbed six places" for an alliance that had not moved at all. Worse than
-- a wrong chart, because the compare table is sorted on it.
--
-- Rank edges are now taken WITHIN one board. `rank_climb` / `rank_first` /
-- `rank_last` keep their names and mean the server board; the cross-server board
-- gets its own three columns appended. An alliance only ever seen on one board has
-- nulls for the other, which is correct — it has not been measured there.
--
-- Column order is unchanged up to the new ones: `create or replace view` can
-- append columns but not reorder or retype them.
create or replace view public.alliance_growth as
with scoped as (
  select
    s.alliance_id,
    s.captured_at,
    s.power,
    s.rank,
    case
      when min(s.server_id) over (partition by s.observation_id)
         <> max(s.server_id) over (partition by s.observation_id)
        then 'cross_server'
      else 'server'
    end as board_scope
  from public.alliance_snapshots s
  where s.power is not null
),
bounds as (
  select
    alliance_id,
    min(captured_at) as first_at,
    max(captured_at) as last_at,
    count(*) as readings
  from scoped
  group by alliance_id
),
edges as (
  select
    b.alliance_id,
    b.first_at,
    b.last_at,
    b.readings,
    (select s.power from scoped s
      where s.alliance_id = b.alliance_id and s.captured_at = b.first_at
      order by s.power desc limit 1) as power_first,
    (select s.power from scoped s
      where s.alliance_id = b.alliance_id and s.captured_at = b.last_at
      order by s.power desc limit 1) as power_last
  from bounds b
),
-- One row per alliance per board, so an edge can never pair a server rank with a
-- cross-server one. `readings` here is per board too: two readings on the server
-- board is a measurement, one reading on each board is not.
rank_edges as (
  select
    alliance_id,
    board_scope,
    count(*) as readings,
    (array_agg(rank order by captured_at, power desc))[1] as rank_first,
    (array_agg(rank order by captured_at desc, power desc))[1] as rank_last
  from scoped
  where rank is not null
  group by alliance_id, board_scope
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
  case when sv.readings > 1 then sv.rank_first - sv.rank_last end as rank_climb,
  sv.rank_first,
  sv.rank_last,
  extract(epoch from (e.last_at - e.first_at)) / 86400.0 as span_days,
  cs.rank_first as cross_rank_first,
  cs.rank_last as cross_rank_last,
  case when cs.readings > 1 then cs.rank_first - cs.rank_last end as cross_rank_climb
from edges e
join public.alliances a on a.alliance_id = e.alliance_id
left join rank_edges sv
  on sv.alliance_id = e.alliance_id and sv.board_scope = 'server'
left join rank_edges cs
  on cs.alliance_id = e.alliance_id and cs.board_scope = 'cross_server';

comment on view public.alliance_growth is
  'Power and rank movement per alliance. Rank edges are taken within ONE board: '
  'rank_climb/rank_first/rank_last are the server board, cross_rank_* are the '
  'cross-server board. Mixing them reported six places of movement for an '
  'alliance that had not moved — the two boards report the same alliance at '
  'different ranks, minutes apart, under the same command name.';
