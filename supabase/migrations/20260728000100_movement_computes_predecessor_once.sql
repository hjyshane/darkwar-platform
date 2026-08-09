-- 0100: same rule as 0088, computed once instead of once per member.
--
-- `pg_stat_statements` on production, for the exact nine-column select the roster
-- screen makes against `rank_period_movement`: 64 calls, mean 3,173 ms, max
-- 7,949 ms — the statement timeout, seen as a 500 on the members screen. PR #171
-- folded the component behind a click to stop the bleeding and said the fix
-- belongs here.
--
-- WHAT ACTUALLY COLLAPSED. Reproduced locally against the production shape
-- (seven period×version combinations, 96 members each): 2 ms as superuser,
-- 137 ms as an authenticated member. The difference is RLS. `member_read` on
-- `rank_period_snapshots` calls `current_app_role()`, which is SECURITY DEFINER
-- with a `SET search_path` clause — a function the planner can neither inline
-- nor estimate. Every scan of the table gets a filter qual with default
-- selectivity, every row estimate collapses to 1, and at rows=1 the planner
-- reaches for nested loops. That put 0088's `prior` subquery — "the most recent
-- earlier period built under the same scoring version" — on the inner side of
-- the final join, where it re-ran FOR EVERY MEMBER: 96 members × 96 rows
-- rescanned = 9,216 executions of the RLS qual in that node alone, ~9,700 in
-- the statement. Each call sets and restores search_path and runs a lookup on
-- `app_users`. At production's per-call cost that is the whole 3 seconds.
--
-- (The "seven columns fast, nine slow" observation in #171 dissolves on the
-- same evidence: the fast entries date from 0087's definition, which read
-- `rank_period_latest` and had no per-row subquery to re-run. Column count was
-- never the variable.)
--
-- THE FIX IS A FENCE, NOT AN ESTIMATE. `as materialized` pins each of the four
-- reads of `rank_period_snapshots` to exactly one execution, whatever the
-- planner believes about row counts. It cannot get the estimates right here —
-- the RLS qual is opaque to it by design — so the shape must not depend on
-- them. Local, same member session: 137 ms → 9 ms, every base-table scan at
-- loops=1. 60_movement_plan_test pins the fences the same way 59 pins the
-- growth-view pushdown: on the plan, where the fault lives, not on a stopwatch.
--
-- The rule itself is 0088's, unchanged and restated: compare against the most
-- recent earlier period built under THE SAME scoring version; a period with no
-- same-version predecessor yields no comparison. Output equivalence was checked
-- shape by shape — production shape, no-predecessor, single period, empty —
-- old and new definitions returned identical rows in all four.
create or replace view public.rank_period_movement
with (security_invoker = true) as
with newest as materialized (
  -- The period being reported on, and the version it was built under.
  select period_start, scoring_version
  from public.rank_period_snapshots
  order by period_start desc, scoring_version desc
  limit 1
),
prior as materialized (
  -- The most recent EARLIER period carrying that same version. Not merely the
  -- previous period: one built only under an older scoring version answers a
  -- different question, and subtracting the two reports the difference between
  -- the questions.
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
  -- Signed so positive means CLIMBED. R1 is the lowest tier and R3 the highest.
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

comment on view public.rank_period_movement is
  'Movement between the newest rank period and the most recent earlier one built '
  'under THE SAME scoring version (0088''s rule). Each read of '
  'rank_period_snapshots is behind AS MATERIALIZED on purpose: the RLS qual is '
  'unplannable, the row estimates under it collapse to 1, and without the fences '
  'the predecessor lookup re-ran once per member — 3 seconds on production '
  '(0100). A period with no same-version predecessor yields no comparison.';
