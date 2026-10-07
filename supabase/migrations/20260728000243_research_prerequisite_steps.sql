-- 0243: the planner reads a research's whole prerequisite tree in one call.
--
-- Research needs the Research Center at some level AND earlier research
-- (aps_science.building_condition / science_condition). The importer now stores
-- both in game_upgrade_steps.requires (a requirement with kind "research" names
-- a research; one with no kind is a building, as before). The deepest research
-- has a chain of 47 distinct researches back to its roots, and the biggest goal
-- drags in 631 earlier steps. The planner used to find prerequisites one round of
-- requests at a time, capped at 10 rounds: that would have dropped the tail of a
-- long chain without a word, and 47 sequential round trips would be slow anyway.
--
-- This returns every step of every research the given ones need, directly or
-- through other research, as one jsonb array (a single value, so PostgREST's
-- silent 1,000-row cap does not apply). Buildings are not followed: a building
-- requirement only ever names a building, which the planner already loads.
--
-- Whole climbs, not just the levels needed: the closure is small, and which
-- levels matter depends on the account, which the database does not know.

create function public.research_prerequisite_steps(p_subjects text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive reach(subject) as (
    select s from unnest(p_subjects) as s
    union
    select r ->> 'subject'
      from reach
      join public.game_upgrade_steps st
        on st.kind = 'research' and st.subject_id = reach.subject
     cross join lateral jsonb_array_elements(st.requires) as r
     where r ->> 'kind' = 'research'
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'kind', st.kind,
             'subject_id', st.subject_id,
             'level', st.level,
             'name', st.name,
             'costs', st.costs,
             'seconds', st.seconds,
             'requires', st.requires,
             'tier', st.tier)
           order by st.subject_id, st.level),
         '[]'::jsonb)
    from public.game_upgrade_steps st
   where st.kind = 'research'
     and st.subject_id in (select subject from reach)
$$;

revoke all on function public.research_prerequisite_steps(text[]) from public, anon;
grant execute on function public.research_prerequisite_steps(text[]) to authenticated;

comment on function public.research_prerequisite_steps(text[]) is
  'Every step of the given researches and of every research they need, directly '
  'or through others, as a jsonb array (0243). The planner''s one-call read of a '
  'research''s prerequisite tree.';
