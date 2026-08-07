-- 0089: pressing Rebuild changes the rank on screen.
--
-- It did not, reliably. `player_current_rank` (0059) picks one snapshot per
-- member with
--
--     select distinct on (player_id) * from rank_period_snapshots
--     order by player_id, period_start desc
--
-- and that ORDER BY has no tie-break. A period holds one row per member PER
-- SCORING VERSION — `build_rank_period` never rewrites an old answer, by design
-- (0071, and the runbook says so twice) — so the newest period has three rows
-- for the same member today: v2, v3 and v4. `distinct on` keeps whichever the
-- scan reaches first among rows that tie on the ORDER BY, which is arbitrary.
--
-- Measured on the live database before this migration: of 95 members, 59 were
-- showing a tier from an OLDER scoring version than the one that existed for
-- them. Rebuild wrote v4 for everybody and the roster went on showing a mixture
-- of v2 and v3. That is the whole complaint — the dropdown's computed rank did
-- not follow the rebuild — and it is not a caching problem, it is this query.
--
-- The fix is not new code. `rank_period_latest` (0071) already means "the newest
-- scoring_version per member per period", and the movement report has read it
-- since it existed. 0059 was written BEFORE 0071 and kept its own copy of the
-- pick; this points it at the shared one, so there is one definition of "the
-- current answer" rather than two that disagree.
--
-- Old version rows stay. They are the basis of the judgement made at the time
-- (CLAUDE.md: never overwrite historical scores). Keeping an old answer is not
-- the same as showing it.

-- Same columns in the same order, so `create or replace` is enough and nothing
-- downstream has to be re-granted.
create or replace view public.player_current_rank
with (security_invoker = true) as
select
  coalesce(latest.player_id, assigned.player_id) as player_id,
  assigned.assigned_rank,
  latest.period_start,
  latest.tier as computed_tier,
  latest.tier_reason as computed_reason,
  latest.activity_score as rank_score,
  latest.donation_pct,
  latest.duel_pct,
  latest.growth_pct
from (
  -- One row per member: their newest period, at its newest scoring version.
  -- `rank_period_latest` has already reduced each period to one version, so this
  -- only has to choose the period.
  select distinct on (player_id) *
  from public.rank_period_latest
  order by player_id, period_start desc
) as latest
full join public.player_ranks as assigned using (player_id);

comment on view public.player_current_rank is
  'What an admin set and what the last period worked out, for each member. '
  'Reads rank_period_latest, so a rebuild is visible immediately: the newest '
  'period at its newest scoring version, never an older version that happens '
  'to share the period. security_invoker: both sides are member-only.';
