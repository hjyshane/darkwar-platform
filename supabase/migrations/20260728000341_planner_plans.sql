-- 0341: planner_plans - a planner's choices, saved under a name.
--
-- The planner (item 4) worked out what a set of upgrades costs and then forgot
-- it on reload: "what to raise" lived in the page. The owner asked (2026-11-20)
-- for a plan to be saved and read back from My account. One row per saved
-- plan:
--   targets      [{kind, subject, name, from, to, stageFrom?, stageTo?}]
--                the planner's own Target list, as the page holds it
--   extra_buffs  {constructionSpeed, researchSpeed, costReduction}
--                the presidential / emergency-project buff typed on top
--   with_prereqs whether the buildings a building needs first are counted
--
-- WHAT IT DELIBERATELY IS NOT.
--   * Not the account's state. Levels, stock and login buffs stay where they
--     are (0205, 0223); a plan opened later is costed against the account as
--     it is THEN, which is the point of keeping it.
--   * Not shared. A plan is its author's note: own rows only, every role, a
--     community account (0282) included - it may plan, so it may keep a plan.
--   * player_id has no foreign key, on purpose. It only says which account to
--     reopen the plan for; a community account plans for no character at all
--     (null), and a character that has gone should not take the plan with it.
--     account_name is the name as it was when saved, so the list in My account
--     is one query and reads sensibly either way.

create table public.planner_plans (
  plan_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  player_id uuid,
  account_name text not null default '' check (char_length(account_name) <= 80),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  targets jsonb not null default '[]'::jsonb
    check (jsonb_typeof(targets) = 'array' and jsonb_array_length(targets) <= 300),
  extra_buffs jsonb not null default '{}'::jsonb check (jsonb_typeof(extra_buffs) = 'object'),
  with_prereqs boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.planner_plans is
  'A material planner''s choices saved under a name (0341): what to raise, the '
  'buff typed on top, whether prerequisites count. Private to its author.';

-- My account lists one user's plans, newest first.
create index planner_plans_user_idx on public.planner_plans (user_id, updated_at desc);

create function public.touch_planner_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_planner_plan() from public, anon, authenticated;

create trigger planner_plans_touch
  before update on public.planner_plans
  for each row execute function public.touch_planner_plan();

alter table public.planner_plans enable row level security;
revoke all on public.planner_plans from anon, authenticated;
grant select, insert, update, delete on public.planner_plans to authenticated;
grant all on public.planner_plans to service_role;

create policy own_plans on public.planner_plans
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
