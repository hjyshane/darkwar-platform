-- 0151: the same fix for the alliance trends tab.
--
-- Measured on production as service_role, RLS bypassed:
--
--   alliance_daily_contribution, alliance_id=eq.<own>   6.38 s
--   alliance_daily_contribution, no filter              TIMEOUT (500)
--
-- `roster` was `select distinct alliance_id, game_uid from
-- alliance_member_snapshots` — a DISTINCT over all 1,757,827 rows, computed
-- on every visit to answer about one alliance. The filter cannot save it: a
-- qual that reaches the CTE still leaves the planner sorting the whole table
-- to make it distinct, and in practice it did not reach it at all.
--
-- Same rewrite as 0150. Drive from `alliances`, make the roster a LATERAL
-- correlated to it, and the filter lands on a primary key with an index
-- descent underneath — `alliance_member_snapshots_alliance_captured_idx`
-- (0003) for the members, `alliance_contribution_snapshots_uid_type_idx`
-- (0110) for their scores.
--
-- MEMBERSHIP HERE IS EVERYONE EVER SEEN, not the current roster, and that is
-- deliberately preserved. A trends chart reads a HISTORY: the contributions
-- somebody made in July are still contributions the alliance made in July,
-- and re-attributing them by today's roster would rewrite the past every time
-- somebody leaves. This is the one place `alliance_roster_latest` would be
-- the wrong answer, which is why the DISTINCT stays a DISTINCT and only moves
-- under the LATERAL.
--
-- Nothing else changes: the same 02:00 UTC game-day boundary, the same
-- max(score) per member per day per board, the same `readings` count that
-- tells a reader whether a day was read once early or read to its end, and
-- the same member-or-service predicate 0077 put on it.

create or replace view public.alliance_daily_contribution as
with best as (
  select
    a.alliance_id,
    -- The game day this capture belongs to, as its 02:00 UTC start.
    date_trunc('day', s.captured_at - interval '2 hours') + interval '2 hours' as game_day,
    s.contribution_type as kind,
    s.game_uid,
    max(s.score) as score,
    max(s.captured_at) as last_capture_at,
    count(*) as readings
  from public.alliances a
  -- Everyone ever seen in THIS alliance.
  join lateral (
    select distinct m.game_uid
    from public.alliance_member_snapshots m
    where m.alliance_id = a.alliance_id
  ) r on true
  join public.alliance_contribution_snapshots s
    on s.game_uid = r.game_uid
   and s.score is not null
  group by 1, 2, 3, 4
)
select
  alliance_id,
  game_day,
  kind,
  sum(score) as total,
  count(*) as members_counted,
  round(avg(score)) as avg_per_member,
  max(last_capture_at) as last_capture_at,
  -- More than one reading of the same board on the same day means the total is
  -- the end of the day rather than a moment in it. Worth carrying: on a day read
  -- once, early, the figure is a partial day and looks like a bad day.
  max(readings) as readings
from best
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request())
group by alliance_id, game_day, kind;
