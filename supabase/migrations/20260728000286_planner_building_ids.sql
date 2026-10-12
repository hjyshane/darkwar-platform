-- 0286: which buildings an account has, for a planner with no account.
--
-- A login lists the buildings that account has, which is what a member sees in
-- What to raise. A community account (0282) has no login and types its levels
-- in, so it has to be offered the same set — not the whole catalogue, which
-- carries season buildings and ones nobody has built (user, 2026-10-12).
--
-- Account state is owner-or-admin (0205), so this cannot be a read: it is a
-- definer function that returns ONLY building ids that appear at level 1 or
-- above in some account's login. No account, level or count leaves it.

create function public.planner_building_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct b.key
  from public.account_state_snapshots s
  cross join lateral jsonb_each(s.buildings) b
  where jsonb_typeof(b.value) = 'number'
    and (b.value #>> '{}')::numeric > 0
$$;

-- 0170: a new function is anon-callable on the hosted project unless anon is
-- named.
revoke all on function public.planner_building_ids() from public, anon;
grant execute on function public.planner_building_ids() to authenticated, service_role;

comment on function public.planner_building_ids() is
  'Building ids that some account''s login shows at level 1 or above. Ids '
  'only: the planner lists these for an account with no login.';
