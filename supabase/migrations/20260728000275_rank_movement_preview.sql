-- 0275: a preview of the movement for the fortnight still running.
--
-- `rank_period_movement` (0132) deliberately waits for a fortnight to finish:
-- a period measured a quarter of the way through is not an answer, and the
-- front page must not read it as one. That stays. This is the second door for
-- somebody who knows exactly that and wants to look anyway - an officer
-- rebuilt the period in progress and, correctly, saw nothing change on the
-- Members tab.
--
-- A separate view rather than a flag on the first one, so the finished-only
-- rule cannot be loosened by accident and the dashboard has to ASK for the
-- partial answer by name. Same shape, same comparison rule (the most recent
-- earlier period built under the SAME scoring version), same AS MATERIALIZED
-- fences (0100: the RLS qual is unplannable and the predecessor lookup re-ran
-- once per member without them).
--
-- Exactly the opposite eligibility to 0132: only a period whose fortnight has
-- NOT ended. When none is running the view is empty, and the dashboard says so.
create or replace view public.rank_period_movement_preview
with (security_invoker = true) as
with newest as materialized (
  select period_start, scoring_version
  from public.rank_period_snapshots
  where period_start + interval '2 weeks' > now()
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
  -- Signed so positive means CLIMBED, as in 0087.
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

comment on view public.rank_period_movement_preview is
  'Movement for the rank period whose fortnight is STILL RUNNING against the '
  'most recent earlier period under the same scoring version. The mirror of '
  'rank_period_movement (0132), which refuses this period on purpose: it is '
  'measured part of the way through. Empty when no fortnight is running.';

-- Hosted projects hand new relations to `authenticated` with every privilege
-- including TRUNCATE (see 0185). Take it all back, then give the one thing.
revoke all on public.rank_period_movement_preview from public, anon, authenticated;
grant select on public.rank_period_movement_preview to authenticated;
