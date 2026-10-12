-- 0281: the rank on the member list takes the LAST period, finished or not.
--
-- 0134 made `player_current_rank` skip a fortnight still running, so the member
-- list stayed on the previous answer until the new period closed. The operator
-- has decided the other way: when the newest period is the last one that was
-- worked out, it is the answer in force, even if it is unfinished. A rank that
-- follows the last Build is what the screen is for; the wait left the list
-- showing a fortnight the alliance had already moved on from.
--
-- WHAT THIS BRINGS BACK, stated plainly because 0134 spent a header arguing
-- against it: a period built early is graded off a partial reading (2026-08-17
-- was built two hours after it opened — donation week 2 and both duel weeks
-- empty), and the list will show that tier until the period is rebuilt. That is
-- the trade, taken knowingly. It is also why nothing here picks a period by
-- clock: the rule is "the newest period that exists", so pressing Rebuild on the
-- period in progress moves the roster again (0089's behaviour).
--
-- "Last" is per member and per what has been built. A fortnight nobody has
-- built has no rows in `rank_period_latest` and cannot be chosen; the previous
-- built period stays in force until the new one is created.
--
-- Same columns in the same order as 0156, so `create or replace` is enough and
-- nothing downstream has to be re-granted. The full join keeps a hand-set rank
-- visible with no period behind it.

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
  latest.growth_pct,
  coalesce(latest.below_minimum, false) as below_minimum,
  latest.minimum_missed
from (
  -- One row per member: their newest period at its newest scoring version.
  -- `rank_period_latest` has already reduced each period to one version.
  select distinct on (player_id) *
  from public.rank_period_latest
  order by player_id, period_start desc
) as latest
full join public.player_ranks as assigned using (player_id);

comment on view public.player_current_rank is
  'What an admin set and what the LAST period worked out, for each member — '
  'finished or still running (0281, undoing 0134''s wait). Reads '
  'rank_period_latest, so a rebuild is visible immediately at its newest '
  'scoring version. Carries 0155''s below_minimum/minimum_missed. '
  'security_invoker: both sides are member-only.';

-- `member_roster_current` materialises this view on write (0106); replacing the
-- view does not touch rows already in it.
select public.refresh_member_roster();
