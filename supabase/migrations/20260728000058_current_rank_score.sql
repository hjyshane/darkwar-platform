-- 0058: carry the score that decided the rank, next to the rank.
--
-- A rank on its own is an assertion. The number behind it is what makes it
-- arguable, and the person being moved down is going to ask — so the roster
-- shows both rather than sending them to a report to find out why.
--
-- Dropped and recreated rather than replaced, because the new columns belong
-- beside the tier they explain and CREATE OR REPLACE VIEW can only append.
-- 0051 lost this view's grants doing exactly this, so the grant is restated
-- below and 29_growth_test exists because of it.
drop view public.player_current_rank;

create view public.player_current_rank
with (security_invoker = true) as
select distinct on (player_id)
  player_id,
  period_start,
  tier as computed_tier,
  tier_reason as computed_reason,
  activity_score as rank_score,
  donation_pct,
  duel_pct,
  growth_pct
from public.rank_period_snapshots
order by player_id, period_start desc;

comment on view public.player_current_rank is
  'The newest period''s verdict for each member: the tier, the score it came '
  'from, and the three normalised figures that made the score. '
  'security_invoker, so rank_period_snapshots'' member-only policy decides.';

grant select on public.player_current_rank to authenticated;
