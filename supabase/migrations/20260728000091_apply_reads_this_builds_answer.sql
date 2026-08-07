-- 0091: applying a rebuild may only act on what THAT rebuild produced.
--
-- 0090 asked `rank_period_latest` whether the member had a tier, and that view
-- means "the newest scoring version present for this member in this period" —
-- which is not the same as "what the rebuild just wrote".
--
-- The two come apart because `build_rank_period` does not write a row for every
-- member. A member it will not grade — joined inside the fortnight, or nothing
-- captured — gets no row at all in a period it has no basis for. So a period
-- that still holds v1 rows can be rebuilt under v4, the v4 pass writes rows for
-- the members it can grade and skips the rest, and for those skipped members the
-- newest row in that period remains the V1 ONE. Their tier reads non-null, the
-- guard concludes the period graded them, and their hand-set rank is deleted on
-- the strength of an answer the current formula never gave.
--
-- This is not hypothetical on this database. Right now 2026-06-29, 2026-07-13
-- and 2026-07-27 hold nothing but v1 rows, 95 each, every one carrying a tier —
-- v1 scored an unobserved member as 0 and filed them R1 rather than leaving them
-- ungraded, which is the exact fault 0071 was written to undo. Ticking the box
-- while one of those periods is selected would clear overrides on the strength of
-- v1's answers.
--
-- So the guard now requires the member's newest row to be at the period's newest
-- VERSION as well: the row this rebuild just wrote, and nothing older wearing its
-- period.
create or replace function public.rebuild_rank_period(
  p_period_start timestamptz,
  p_apply_to_assigned boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written integer;
  current_version integer;
begin
  -- Raises 42501 for a non-member, which is the check that guards both halves.
  written := public.build_rank_period(p_period_start);

  if p_apply_to_assigned and public.has_permission('members.manage') then
    -- The version the pass above wrote. Read back rather than passed in: the
    -- scoring version lives inside `build_rank_period` and bumping it there must
    -- not need a matching edit here.
    select max(scoring_version) into current_version
    from public.rank_period_snapshots
    where period_start = p_period_start;

    delete from public.player_ranks as pr
    where pr.assigned_rank in ('R1', 'R2', 'R3')
      and exists (
        select 1
        from public.rank_period_latest as l
        where l.player_id = pr.player_id
          and l.period_start = p_period_start
          -- Both halves matter. `tier is not null` keeps a member the period
          -- could not grade — clearing them would leave them with no rank at
          -- all. `scoring_version = current_version` keeps a member this pass
          -- SKIPPED, whose newest row is an older version's answer.
          and l.scoring_version = current_version
          and l.tier is not null
      );
  end if;

  return written;
end;
$$;

comment on function public.rebuild_rank_period(timestamptz, boolean) is
  'Rebuilds a period, and optionally applies it: with p_apply_to_assigned, a '
  'computed R1-R3 replaces a hand-set R1-R3 by clearing the override, so the '
  'roster shows the new answer. Only ever on the strength of the row this '
  'rebuild wrote — a member it skipped keeps their rank rather than being '
  'judged by an older scoring version that still wears the same period. R4 and '
  'R5 are left alone; the clearing half needs members.manage and an explicit '
  'yes.';
