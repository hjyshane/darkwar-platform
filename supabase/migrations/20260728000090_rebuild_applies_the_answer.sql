-- 0090: a rebuild applies its answer to R1-R3, and leaves R4/R5 alone.
--
-- Until now a hand-set rank won permanently. `player_current_rank` shows
-- `assigned_rank ?? computed_tier`, so once an admin had typed R2 for somebody,
-- no rebuild would ever move them again — 23 of 95 members were in that state,
-- and from the members table it looked like Rebuild simply did not work on them.
--
-- R4 and R5 stay hand-set. They are limited seats in the game, handed out by a
-- person for reasons no score models (0072 already refuses to COMPUTE them), so
-- clearing those would delete a decision rather than refresh a calculation.
--
-- COMPUTING AND APPLYING ARE TWO DIFFERENT ACTS, so they are two functions.
-- `build_rank_period` writes snapshots and touches nothing an admin owns; it is
-- also what a member with no rank permission may run. This wrapper is the one
-- that edits `player_ranks`, and it is gated on `members.manage` — the same
-- permission the roster's own rank dropdown checks. A member pressing Rebuild
-- gets the recalculation and none of the deletion.
--
-- The override is DELETED, not overwritten with the computed value. A row in
-- `player_ranks` means "a person decided this", and writing the computed answer
-- there would make every rebuilt rank look hand-set — the roster draws an
-- assigned rank solid and a computed one faded, and that distinction is the
-- point of having both.
-- IT IS A CHOICE, MADE PER REBUILD, and it defaults to NO. Clearing an override
-- destroys something a person typed and cannot be undone from the screen, so the
-- caller has to ask for it: pressing Rebuild without ticking the box recomputes
-- and changes nobody's assigned rank. `default false` also means an old client —
-- or anything else still calling this with one argument — cannot delete a rank by
-- accident.
create function public.rebuild_rank_period(
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
begin
  -- Raises 42501 for a non-member, which is the check that guards both halves.
  written := public.build_rank_period(p_period_start);

  if p_apply_to_assigned and public.has_permission('members.manage') then
    delete from public.player_ranks as pr
    where pr.assigned_rank in ('R1', 'R2', 'R3')
      -- ONLY where this rebuild actually produced a tier to replace it with.
      -- A member the period could not measure — someone we first saw a week ago,
      -- whose every row reads "joined within the last two weeks" — would
      -- otherwise be left with no rank at all, which is worse than a stale one.
      and exists (
        select 1
        from public.rank_period_latest as l
        where l.player_id = pr.player_id
          and l.period_start = p_period_start
          and l.tier is not null
      );
  end if;

  return written;
end;
$$;

comment on function public.rebuild_rank_period(timestamptz, boolean) is
  'Rebuilds a period, and optionally applies it: with p_apply_to_assigned, a '
  'computed R1-R3 replaces a hand-set R1-R3 by clearing the override, so the '
  'roster shows the new answer. R4 and R5 are left alone — they are limited '
  'seats a person hands out, not a calculation. The clearing half needs '
  'members.manage and an explicit yes; the computing half needs neither.';

grant execute on function public.rebuild_rank_period(timestamptz, boolean) to authenticated;
