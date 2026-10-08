-- 0247: the planner reads "what could this account upgrade next" in one call.
--
-- Ranking the next upgrades (recommend.ts) needs, for every building and
-- research the account could advance, the step it would take and the power of
-- the level it stands on. Per subject that is hundreds of requests, and
-- game_upgrade_steps is over 16,000 rows against PostgREST's silent
-- 1,000-row cap. This returns it as one jsonb array, which is a single value
-- and so not capped (the same shape as research_prerequisite_steps, 0243).
--
-- It takes the account's levels as arguments instead of reading them. The
-- planner already holds them, for logins AND for hand-entered accounts
-- (account_state_manual), and reading them here would mean a second gate to
-- get right on someone else's account state. Nothing but game_upgrade_steps
-- is read, so it exposes exactly what members could already select.
--
-- game_upgrade_steps.power is the power AT a level, not what a step adds, so
-- `current` carries the power of the level the account stands on and the
-- caller subtracts. `current` is {level, power} whenever the account owns the
-- thing, with power null if the catalogue has no row for that level: a gap is
-- UNKNOWN, never "from zero", which would overstate the gain.
--
-- WHICH SUBJECTS. Everything the account owns (level above 0) and has a next
-- step for; the caller sorts out which are blocked. Things it owns nothing of
-- come back only when their first step's requirements are all met, because the
-- catalogue holds furniture and buildings from seasons this account has no
-- access to, and listing them all as "blocked" would bury the real ones.
-- Buildings and research only: they are what has power in the catalogue
-- (heroes, gear and exclusives have none, checked 2026-10-08).

create function public.recommend_step_pairs(p_buildings jsonb, p_science jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with owned as (
    select 'building'::text as kind, e.key as subject_id, e.value::int as lvl
      from jsonb_each_text(case when jsonb_typeof(p_buildings) = 'object' then p_buildings else '{}'::jsonb end) e
     where e.value ~ '^[0-9]{1,6}$' and e.value::int > 0
    union all
    select 'research', e.key, e.value::int
      from jsonb_each_text(case when jsonb_typeof(p_science) = 'object' then p_science else '{}'::jsonb end) e
     where e.value ~ '^[0-9]{1,6}$' and e.value::int > 0
  ),
  subjects as (
    select distinct kind, subject_id
      from public.game_upgrade_steps
     where kind in ('building', 'research')
  ),
  base as (
    select s.kind, s.subject_id,
           coalesce(o.lvl, 0) as lvl,
           o.lvl is not null as is_owned
      from subjects s
      left join owned o using (kind, subject_id)
  ),
  pairs as (
    select b.kind, b.subject_id, b.lvl, nx.name, nx.level as next_level, nx.costs,
           nx.seconds, nx.requires, nx.power as next_power, cur.power as cur_power
      from base b
      join public.game_upgrade_steps nx
        on nx.kind = b.kind and nx.subject_id = b.subject_id and nx.level = b.lvl + 1
      left join public.game_upgrade_steps cur
        on cur.kind = b.kind and cur.subject_id = b.subject_id and cur.level = b.lvl
     where b.is_owned
        or not exists (
          select 1
            from jsonb_array_elements(nx.requires) r
           where coalesce(
                   ((case when r ->> 'kind' = 'research' then p_science else p_buildings end)
                      ->> (r ->> 'subject'))::int, 0) < (r ->> 'level')::int)
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'current', case when lvl > 0
                          then jsonb_build_object('level', lvl, 'power', cur_power)
                        end,
             'next', jsonb_build_object(
               'kind', kind,
               'subject_id', subject_id,
               'level', next_level,
               'name', name,
               'costs', costs,
               'seconds', seconds,
               'requires', requires,
               'power', next_power))
           order by kind, subject_id),
         '[]'::jsonb)
    from pairs
$$;

revoke all on function public.recommend_step_pairs(jsonb, jsonb) from public, anon;
grant execute on function public.recommend_step_pairs(jsonb, jsonb) to authenticated;

comment on function public.recommend_step_pairs(jsonb, jsonb) is
  'For an account''s building and research levels: each thing''s next step and '
  'the power of the level it stands on, as one jsonb array (0247). Feeds the '
  'planner''s upgrade ranking. game_upgrade_steps.power is power AT a level.';
