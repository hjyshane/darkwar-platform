-- 0132: the Members tab compares finished fortnights only.
--
-- `rank_period_movement` reported on "the newest period that exists". That was
-- fine while the only periods anybody built were closed ones. It stopped being
-- fine the moment the rank report screen started defaulting to the period IN
-- PROGRESS, because pressing Build then created a fortnight measured a quarter
-- of the way through — and the Members tab immediately made it the headline.
--
-- Seen on production the day it happened: 2026-08-17 was built two hours after
-- it opened, with donation week 1 present for 83 members and week 2, duel week
-- 1 and duel week 2 all empty. Median activity score 17.5 against 50.2 for the
-- fortnight before it. Nothing was wrong with either number. One of them was a
-- quarter of an answer, and it was the one on the front page.
--
-- So the view now waits. A period is eligible when its fortnight has ENDED;
-- until then the newest finished one stays on screen, which is the last
-- complete thing anybody can act on.
--
-- NO FALLBACK to "the newest that exists" when nothing has finished. That
-- fallback is exactly the behaviour being removed, and on a database with no
-- complete period the honest answer is no comparison rather than a partial one
-- dressed as a full one. The rank report screen still shows the period in
-- progress on request — that is where the partial answer belongs, next to the
-- sentence explaining it.
create or replace view public.rank_period_movement
with (security_invoker = true) as
with newest as materialized (
  -- The newest FINISHED period, and the version it was built under.
  select period_start, scoring_version
  from public.rank_period_snapshots
  where period_start + interval '2 weeks' <= now()
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
  'Movement between the newest FINISHED rank period and the most recent earlier '
  'one built under THE SAME scoring version (0088''s rule, 0132''s wait). A '
  'period whose fortnight is still running is excluded: it is measured part of '
  'the way through, and the front page must not read a quarter of an answer as '
  'a whole one. Each read of rank_period_snapshots is behind AS MATERIALIZED on '
  'purpose: the RLS qual is unplannable, the row estimates under it collapse to '
  '1, and without the fences the predecessor lookup re-ran once per member — 3 '
  'seconds on production (0100). No finished period, or none with a same-version '
  'predecessor, yields no comparison.';
