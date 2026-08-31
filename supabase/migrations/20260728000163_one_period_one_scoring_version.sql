-- 0163: a period is served by ONE scoring version, not one per member.
--
-- `rank_period_latest` picked `distinct on (period_start, player_id)` ordered by
-- `scoring_version desc` — the newest version PER MEMBER. That was safe for as
-- long as every rebuild scored the same people: a rebuild wrote a new row for
-- everybody, so the newest version won for everybody and a period came out
-- uniform.
--
-- 0161 ended that. Version 7 scores the current roster (82) where version 6
-- scored everyone who had ever been in it (96). The 14 who dropped out were
-- never rescored, so nothing superseded their old rows, and the view served
-- them alongside the new ones. On the fortnight opening 2026-08-17 that meant
-- THREE versions in one answer: two members still on version 4, twelve on
-- version 6, and the rest on 7.
--
-- The damage was not cosmetic. A tier is a percentile of the pool that was
-- scored, so a version-4 score of 3.5 and a version-7 score of 9.9 are not
-- comparable numbers — and the report put them in one column sorted by score,
-- showing a member with 3.5 holding R2 while a member with 9.9 held R1. Read as
-- a promotion list it said to promote the fossil and demote the person who
-- actually did the work.
--
-- Now: the newest version that exists FOR THAT PERIOD, and only rows from it.
-- A member absent from that version disappears from the period rather than
-- lingering with a stale answer — which is correct. They were not scored by the
-- rule that produced that period's result, and the honest report of that is
-- nothing, not a number from a different rulebook.
--
-- `computed_at desc` still breaks ties inside one version, for a period rebuilt
-- twice under the same rules.
--
-- THE STAR IS STILL FROZEN AT CREATION (0160). This re-expansion picks up
-- lab_level and lab_adjustment as they stand today; the next migration to add a
-- column to rank_period_snapshots must re-run this create-or-replace too.

create or replace view public.rank_period_latest
with (security_invoker = true) as
with newest as (
  select period_start, max(scoring_version) as scoring_version
  from public.rank_period_snapshots
  group by period_start
)
select distinct on (s.period_start, s.player_id) s.*
from public.rank_period_snapshots s
join newest n
  on n.period_start = s.period_start
 and n.scoring_version = s.scoring_version
order by s.period_start, s.player_id, s.computed_at desc;

comment on view public.rank_period_latest is
  'One period, ONE scoring version: the newest version that exists for that '
  'period, and only rows from it. Picking the newest version per MEMBER '
  'instead (before 0163) mixed versions in a single answer as soon as 0161 '
  'made a rebuild score fewer people than the run before it, and percentiles '
  'from different pools are not comparable. A member absent from the newest '
  'version is absent from the period, not carried forward at an old score. '
  'THE STAR IS FROZEN AT CREATION: a migration adding a column to '
  'rank_period_snapshots must re-run this create-or-replace, or the column is '
  'written but unreadable through the view (0160).';
