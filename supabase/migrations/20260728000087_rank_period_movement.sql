-- 0087: who moved when the last rank period was built.
--
-- The members screen shows where everybody stands. It could not show what CHANGED,
-- and that is the thing an officer acts on: somebody who dropped a tier needs a
-- word, somebody who climbed deserves one, and the biggest gain is worth naming out
-- loud.
--
-- IN SQL BECAUSE THE DIRECTION IS EASY TO GET BACKWARDS, and getting it backwards
-- congratulates the people who slipped. R1 is the LOWEST tier and R3 the highest —
-- measured, not assumed: at 2026-08-03 v4 the mean activity score was 9.1 for R1,
-- 41.9 for R2 and 74.8 for R3, with the bands cleanly separated. So a move from R2
-- to R3 is a climb, and `tier_change` is positive for it. 51_rank_movement_test
-- pins that, because a comment cannot.
--
-- Compared against the PREVIOUS PERIOD at its own newest version, which is what
-- `rank_period_latest` already means (0071): rebuilding a period under a new
-- scoring version supersedes the old answer, and comparing against a superseded one
-- would report movement that the rebuild caused rather than the member.
--
-- Tier NULL at either end is not a move. An officer is measured and deliberately
-- not ranked (0072), and a member with nothing captured has no tier either — so a
-- tier appearing where there was none is a first measurement, not a promotion.
-- That is the same rule `tier_changes` applies before announcing to Discord, and
-- for the same reason: it would be a false statement about somebody's conduct.
-- The tier ordering, in one place.
--
-- Written as a function rather than inlined twice in the view below, because the
-- day a fourth tier appears there must be exactly one edit. IMMUTABLE so it can be
-- used in an index later without a second thought.
--
-- Unknown tiers return null rather than 0: a 0 would sort below R1 and quietly make
-- an unrecognised tier look like the worst one.
create function public.tier_rank(p_tier text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 'R1' then 1
    when 'R2' then 2
    when 'R3' then 3
    when 'R4' then 4
    when 'R5' then 5
  end
$$;

comment on function public.tier_rank(text) is
  'The tier as a comparable number, higher being better. R1 is the LOWEST — at '
  '2026-08-03 v4 the mean activity score was 9.1 for R1, 41.9 for R2 and 74.8 for '
  'R3. Getting this backwards congratulates the people who slipped.';

grant execute on function public.tier_rank(text) to authenticated, anon;

create view public.rank_period_movement
with (security_invoker = true) as
with periods as (
  -- The two newest periods, each already reduced to its newest scoring version by
  -- the view.
  select distinct period_start
  from public.rank_period_latest
  order by period_start desc
  limit 2
),
ranked as (
  select
    period_start,
    row_number() over (order by period_start desc) as recency
  from periods
),
latest as (
  select l.*
  from public.rank_period_latest l
  join ranked r on r.period_start = l.period_start and r.recency = 1
),
previous as (
  select l.*
  from public.rank_period_latest l
  join ranked r on r.period_start = l.period_start and r.recency = 2
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
  -- Signed so positive means CLIMBED, which is what a reader assumes a positive
  -- movement figure means. R1=1, R2=2, R3=3 — the ordering the scores establish.
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
  'Every member''s tier and score at the newest rank period beside the previous '
  'one, with signed changes. tier_change is POSITIVE for a climb: R1 is the lowest '
  'tier and R3 the highest, which the activity score bands establish. Null at '
  'either end means no comparison — an officer is measured and not ranked, and a '
  'first measurement is not a promotion.';

grant select on public.rank_period_movement to authenticated;
