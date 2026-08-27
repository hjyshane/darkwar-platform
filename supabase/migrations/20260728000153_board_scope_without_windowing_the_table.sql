-- 0153: the trend chart's own query, which was the slow one all along.
--
-- 0151 sped up a third of the trends tab. This is the third that actually
-- gated it. Production, service_role, the three queries the tab fires in
-- parallel:
--
--   alliance_power_history        4.33 s   <- the tab waits on this
--   alliance_roster_history       0.99 s
--   alliance_daily_contribution   0.67 s
--
-- `alliance_power_history` carries two window functions, both
-- `partition by s.observation_id`:
--
--   count(*) over (partition by observation_id)                as board_size
--   min(server_id) over (...) <> max(server_id) over (...)     as board_scope
--
-- A qual can only be pushed below a WindowAgg when it references the
-- partitioning columns of every window. `alliance_id = $1` does not reference
-- `observation_id`, so it cannot be pushed: the view sorts and windows all
-- 88,079 rows of `alliance_snapshots` and only then throws away everything
-- that is not the one alliance the caller asked for. Both screens that read
-- this view — the trends chart and the compare table — filter by alliance.
--
-- Same information, computed the other way round: filter first, then ask each
-- surviving row's OBSERVATION how big it was and how many servers it spanned.
-- The lateral is keyed on `observation_id`, which 0128 already indexed, and
-- the outer filter now lands on `alliance_snapshots_alliance_captured_idx`
-- (0003). A reading holds 39 to 100 rows, so the lateral's work per row is an
-- index descent over that, not a sort of the table.
--
-- board_scope is byte-for-byte the same derivation, and it must stay that way:
-- 0081 exists because a server board and the cross-server board are identical
-- in the payload except for the rank number, and the only thing that tells
-- them apart is how many servers the reading covered. `min <> max` rather
-- than `count(distinct)` for the same reason 0081 gives — two different
-- servers in one reading is the whole question.
--
-- Still `security_invoker`, deliberately. 0097 is the migration that had to
-- fix `alliance_growth` for lacking that clause: `alliance_snapshots` is
-- member-only, and neither of these views may become the way around it.

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
    -- min <> max rather than count(distinct): two different servers in one
    -- reading is all this asks.
    when o.min_server <> o.max_server then 'cross_server'
    else 'server'
  end as board_scope,
  o.board_size
from public.alliance_snapshots s
join public.alliances a on a.alliance_id = s.alliance_id
-- What the READING was, asked of the reading rather than of the whole table.
cross join lateral (
  select
    count(*) as board_size,
    min(m.server_id) as min_server,
    max(m.server_id) as max_server
  from public.alliance_snapshots m
  where m.observation_id = s.observation_id
) o;

comment on view public.alliance_power_history is
  'Every captured ranking-board reading, with which board it was. `board_scope` '
  'is derived from how many servers the reading covered, because the payload '
  'itself is identical between a server board and the cross-server board except '
  'for the rank number — plotting both as one series made our own alliance '
  'appear to swing between 1st and 7th every few minutes. Derived per '
  'observation through a LATERAL rather than a window over the table, so a '
  'filter on alliance_id reaches the index (0153).';
