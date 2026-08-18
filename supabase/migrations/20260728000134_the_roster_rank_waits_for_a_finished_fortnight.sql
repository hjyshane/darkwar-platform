-- 0134: the rank on the member list waits for a finished fortnight too.
--
-- 0132 stopped `rank_period_movement` reporting on "the newest period that
-- exists", because the rank report screen defaults to the period IN PROGRESS
-- and pressing Build there creates a fortnight measured a quarter of the way
-- through. It replaced one view and left the other alone, so the Members tab
-- now runs two different rules down one screen: the movement block waits for a
-- period to close, and the rank column in the member list below it does not.
--
-- Same production data, read the other way. 2026-08-17 was built two hours
-- after it opened; the movement block correctly went on comparing fortnights
-- through 08-03, while every computed rank in the list underneath was graded
-- off the partial 08-17 — donation week 1 for 83 members, week 2 and both duel
-- weeks empty. A member reading their own row was reading a quarter of an
-- answer, presented exactly like a whole one.
--
-- So the gate moves here as well. `player_current_rank` is the ONE definition
-- of "the current answer" — 0089 spent its header merging two copies of that
-- pick into this view precisely so a rule like this would only have to be
-- written once — and it feeds the member list, the summary table behind it and
-- every player page. Gating it gates all three.
--
-- WHAT THIS COSTS, stated plainly because it undoes something 0089 bought:
-- pressing Rebuild on the period in progress no longer changes the rank on the
-- roster. 0089 exists because "the dropdown's computed rank did not follow the
-- rebuild" was a real complaint, and this makes that true again for exactly one
-- case — the unfinished period. It is a deliberate trade, taken because a rank
-- nobody can act on is worse than a rank that has not moved yet, and the rank
-- report screen says so on screen rather than leaving it to be discovered.
-- Rebuilding any FINISHED period still moves the roster immediately.
--
-- NO FALLBACK to "the newest that exists" when nothing has finished — the same
-- refusal 0132 made, for the same reason. On a database with no complete period
-- the honest answer is no computed rank at all, and a hand-set rank still shows
-- because it comes through the full join below and never depended on a period.

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
  -- One row per member: their newest FINISHED period, at its newest scoring
  -- version. `rank_period_latest` has already reduced each period to one
  -- version, so this only has to choose the period — and now to skip the ones
  -- still running.
  select distinct on (player_id) *
  from public.rank_period_latest
  where period_start + interval '2 weeks' <= now()
  order by player_id, period_start desc
) as latest
full join public.player_ranks as assigned using (player_id);

comment on view public.player_current_rank is
  'What an admin set and what the last FINISHED period worked out, for each '
  'member. A fortnight still running is skipped (0134): building it gives a '
  'partial answer, and this view is what the member list and every player page '
  'show as the rank. Reads rank_period_latest, so a rebuild of a closed period '
  'is visible immediately at its newest scoring version. security_invoker: '
  'both sides are member-only.';

-- --------------------------------------------------------- the cached copy
--
-- `member_roster_current` materialises this view on write (0106) and is what
-- the member list actually reads. Replacing the view does not touch rows
-- already in that table, so without this the list would go on showing the
-- partial answer until the next snapshot arrived.
--
-- AND A PROPERTY WORTH KNOWING, because it is new: the gate makes the right
-- answer depend on the CLOCK, not only on what has been written. The moment a
-- fortnight closes, the newest finished period becomes a different one — with
-- no insert anywhere to notice. The refresh is triggered by writes to
-- `alliance_member_snapshots`, `player_snapshots` and `rank_period_snapshots`,
-- and the collector writes the first of those every few minutes, so in practice
-- the table catches up within one capture. On a database whose collector is
-- stopped, the roster's rank is as stale as everything else on that screen.
select public.refresh_member_roster();
