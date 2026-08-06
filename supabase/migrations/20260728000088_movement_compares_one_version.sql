-- 0088: compare like with like, or do not compare.
--
-- 0087 shipped with a rule one level too shallow, and the live data said so
-- immediately: 58 members climbed and NOBODY slipped. That is not an alliance, that
-- is a scoring change.
--
--   2026-08-03  built under v2, v3, v4
--   2026-07-27  built under v1 only
--   2026-07-20  built under v2, v3, v4
--
-- 0087 compared the newest period at its newest version (v4) against the previous
-- period at ITS newest version — which for 2026-07-27 is v1. And v1 is the version
-- whose offline-hours calculation 0075 fixed: the median went from 262.9 hours to
-- 2.2 and offline demotions from 70 to 6. So almost everybody sat in R1 under v1 and
-- does not under v4, and the screen reported that as 58 people improving.
--
-- The comment in 0087 said this must not happen. It guarded the wrong edge — a
-- superseded rebuild OF THE SAME period — and left the case where the previous
-- period was never rebuilt at all.
--
-- THE RULE NOW: compare against the most recent earlier period that was built under
-- THE SAME scoring version. Here that skips 2026-07-27 and lands on 2026-07-20, and
-- both ends are v4. A period with no same-version predecessor yields no comparison,
-- which the screen already renders as "no earlier period to compare against" — an
-- honest silence rather than a made-up crowd of climbers.
--
-- The screen prints both dates, so a skipped week is visible rather than implied.
-- Rebuilding 2026-07-27 under v4 would make the comparison adjacent again, and that
-- is an admin action rather than something this view should paper over.
create or replace view public.rank_period_movement
with (security_invoker = true) as
with newest as (
  -- The period being reported on, and the version it was built under.
  select period_start, scoring_version
  from public.rank_period_snapshots
  order by period_start desc, scoring_version desc
  limit 1
),
prior as (
  -- The most recent EARLIER period carrying that same version. Not merely the
  -- previous period: one built only under an older scoring version answers a
  -- different question, and subtracting the two reports the difference between the
  -- questions.
  select s.period_start
  from public.rank_period_snapshots s, newest n
  where s.period_start < n.period_start
    and s.scoring_version = n.scoring_version
  order by s.period_start desc
  limit 1
),
latest as (
  select s.*
  from public.rank_period_snapshots s, newest n
  where s.period_start = n.period_start and s.scoring_version = n.scoring_version
),
previous as (
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
  'under THE SAME scoring version. Comparing across versions reports the scoring '
  'change as member behaviour — v4 against v1 showed 58 climbers and no fallers, '
  'because v1 was the version whose offline hours 0075 fixed. A period with no '
  'same-version predecessor yields no comparison at all.';
