-- 0331: Black Gold plans — who takes which objective, planned ahead.
--
-- Design: docs/superpowers/specs/2026-11-18-bgb-base-placement-design.md
-- (owner's answers 2026-11-18: reuse hive.plan, several drafts per team with
-- one live, starters only).
--
-- WHAT THIS IS. Black Gold is a two-team battle on a fixed objective map, not
-- a tile grid. An officer decides in advance which of a team's 20 starters
-- holds which objective (a military base, a hospital, an oil refinery, the
-- factory, ...) and who is free to roam. Members read their own objective.
-- The game owns the roster; this only plans on top of it.
--
-- TWO TABLES. A plan (alliance, team A/B, a name, one live per team) and its
-- assignments, one row per placed player. Each assignment is one person, so
-- the screen that counts people reads one row per person without folding.
--
-- THE HIVE'S RULES, COPIED RATHER THAN INVENTED (0192, 0194, 0330):
--  * alliance-scoped by a restrictive policy and a guard trigger, because the
--    definer functions below bypass RLS;
--  * a save names the version it was made from and is refused (PT409) if the
--    plan has moved on; the row is locked so two saves cannot both pass;
--  * delete is a flag, restorable for 30 days; the live plan is never a
--    deleted one;
--  * the plan says who last changed it, by the name they had at the time.
--
-- DELIBERATELY NOT HERE. No substitutes (they enter after the battle starts;
-- owner's call). No coordinates: positions on the picture live in the
-- dashboard (features/blackMoney/battlefield.ts), objectives are named here.
-- No new capability: `hive.plan` is the right to plan, as the owner decided.

create table public.bgb_plans (
  plan_id uuid primary key default gen_random_uuid(),
  -- Null means primary, as everywhere since 0192.
  alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.active_alliance(),
  -- 1 = team A, 2 = team B, as black_money_signup_snapshots.team_index.
  team_index int not null check (team_index in (1, 2)),
  name text not null check (length(btrim(name)) > 0),
  note text not null default '',
  -- The plan members are told to follow. At most one per alliance and team,
  -- and never a deleted one. Only make_bgb_plan_live moves it.
  is_live boolean not null default false,
  version int not null default 1,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz not null default now(),
  edited_by uuid references auth.users (id) on delete set null,
  edited_by_name text,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_by_name text
);

comment on table public.bgb_plans is
  'A Black Gold plan for one team: which starter holds which objective. '
  'Several drafts per team, at most one live (0331).';
comment on column public.bgb_plans.version is
  'Moves with every saved change to the name, note or people. A save names '
  'the version it was made from and is refused (PT409) if the plan moved on.';

create unique index bgb_plans_one_live_per_team
  on public.bgb_plans (alliance_id, team_index) nulls not distinct
  where is_live and deleted_at is null;
create index bgb_plans_alliance_team_idx
  on public.bgb_plans (alliance_id, team_index, updated_at desc);

create table public.bgb_plan_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.bgb_plans (plan_id) on delete cascade,
  -- Must match the dashboard's battlefield.ts (a Vitest test reads this list
  -- out of this file). 'roam' is "no fixed spot".
  objective_key text not null check (objective_key in (
    'hq-ours', 'hq-theirs', 'mil-a', 'mil-b', 'hosp-ours', 'hosp-theirs',
    'oil-1', 'oil-2', 'oil-3', 'oil-4', 'oil-5', 'oil-6', 'factory', 'roam')),
  player_id uuid not null references public.players (player_id) on delete cascade,
  -- What one officer writes to be read by another: "carry alloy", "hold".
  role text not null default '' check (length(role) <= 40),
  ordinal int not null default 0,
  created_at timestamptz not null default now(),
  -- A person holds one place in a plan.
  unique (plan_id, player_id)
);

create index bgb_plan_assignments_player_idx on public.bgb_plan_assignments (player_id);

comment on table public.bgb_plan_assignments is
  'One starter''s place in a Black Gold plan. Written only by save_bgb_plan, '
  'which checks they are a starter of that team in the latest signup reading.';

-- ---------------------------------------------------------------------------
-- The actor trigger. Creating a plan is a direct insert (nothing yet to be
-- stale against), so it is where a forged version, stamp, live flag or
-- "already deleted" is stopped: the trigger writes them, whatever was sent.

create function public.bgb_plans_set_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.version := 1;
  new.is_live := false;
  new.edited_at := now();
  new.edited_by := auth.uid();
  new.edited_by_name := internal.hive_actor_name();
  new.deleted_at := null;
  new.deleted_by := null;
  new.deleted_by_name := null;
  return new;
end;
$$;

revoke all on function public.bgb_plans_set_actor() from public, anon, authenticated;

create trigger bgb_plans_set_actor
  before insert on public.bgb_plans
  for each row execute function public.bgb_plans_set_actor();
create trigger bgb_plans_set_updated_at
  before update on public.bgb_plans
  for each row execute function public.set_updated_at();
create trigger guard_alliance
  before insert or update or delete on public.bgb_plans
  for each row execute function public.guard_alliance_row();
create trigger bgb_plans_notify
  after insert or update or delete on public.bgb_plans
  for each statement execute function public.notify_topic_change('bgb_plans');
create trigger bgb_plan_assignments_notify
  after insert or update or delete on public.bgb_plan_assignments
  for each statement execute function public.notify_topic_change('bgb_plans');

-- ---------------------------------------------------------------------------
-- RLS. Reading is by role, writing is by capability (0045, 0165).

alter table public.bgb_plans enable row level security;
alter table public.bgb_plan_assignments enable row level security;

grant select on public.bgb_plans to authenticated;
grant insert on public.bgb_plans to authenticated;
grant select on public.bgb_plan_assignments to authenticated;
grant all on public.bgb_plans to service_role;
grant all on public.bgb_plan_assignments to service_role;
-- No update or delete on plans and no write at all on assignments for the
-- browser: the functions below are the only doors, and they check the version.

-- Members never read a deleted plan; officers do, to restore it.
create policy member_read on public.bgb_plans
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin')
         and (deleted_at is null or (select public.has_permission('hive.plan'))));
create policy planner_insert on public.bgb_plans
  for insert to authenticated
  with check ((select public.has_permission('hive.plan')));

create policy member_read on public.bgb_plan_assignments
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

-- Another alliance's plan is not visible, as 0194 does for the hive.
create policy alliance_scope on public.bgb_plans as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));
-- An assignment is visible when its plan is, deleted plans included or not as
-- the plan's own policy decides.
create policy alliance_scope on public.bgb_plan_assignments as restrictive
  for select to authenticated
  using (exists (select 1 from public.bgb_plans p
                  where p.plan_id = bgb_plan_assignments.plan_id));

-- ---------------------------------------------------------------------------
-- The lock every write starts with. The alliance is judged BEFORE anything
-- else can answer, so a signed-in user from another alliance cannot learn
-- whether a plan exists or which version it is at (0330).

create function internal.bgb_plan_lock(p_plan_id uuid)
returns public.bgb_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.bgb_plans;
begin
  if not public.has_permission('hive.plan') then
    raise exception 'changing a Black Gold plan requires the hive.plan permission'
      using errcode = '42501';
  end if;
  select * into v_plan from public.bgb_plans where plan_id = p_plan_id for update;
  if not found then
    raise exception 'no such plan' using errcode = 'P0002';
  end if;
  perform public.refuse_other_alliance(v_plan.alliance_id);
  return v_plan;
end;
$$;

create function internal.bgb_plan_stamp(p_plan_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.bgb_plans
     set edited_at = now(),
         edited_by = (select auth.uid()),
         edited_by_name = internal.hive_actor_name()
   where plan_id = p_plan_id;
$$;

revoke all on function internal.bgb_plan_lock(uuid) from public, anon, authenticated;
revoke all on function internal.bgb_plan_stamp(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Save the whole plan: name, note and people, in one checked write.
--
-- p_assignments is an array of {objective_key, player_id, role, ordinal}; it
-- replaces the plan's people. Null name or note leaves it unchanged.
--
-- STARTERS ONLY, judged at write time: each player must be a starter (state
-- 1) of THIS team in the newest signup reading on the alliance's server. The
-- game moves people between starter and substitute during registration, so a
-- plan can be out of date later; the editor shows that, the database only
-- refuses to take a non-starter in.

create function public.save_bgb_plan(
  p_plan_id uuid,
  p_version int,
  p_name text,
  p_note text,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.bgb_plans;
  v_server int;
  v_read timestamptz;
  v_stranger uuid;
begin
  v_plan := internal.bgb_plan_lock(p_plan_id);
  if v_plan.deleted_at is not null then
    raise exception 'this plan was deleted' using errcode = 'P0002';
  end if;
  if p_version is distinct from v_plan.version then
    raise exception 'somebody else saved this plan after you opened it'
      using errcode = 'PT409';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'the people must be a json array of {objective_key, player_id, role, ordinal}'
      using errcode = '22023';
  end if;
  if p_name is not null and length(btrim(p_name)) = 0 then
    raise exception 'a plan needs a name' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as a(player_id uuid)
     group by a.player_id having count(*) > 1 or a.player_id is null
  ) then
    raise exception 'a player appears twice, or without an id, in one save'
      using errcode = '22023';
  end if;

  select al.server_id into v_server
    from public.alliances al
   where al.alliance_id = coalesce(v_plan.alliance_id, public.primary_own_alliance());
  select max(s.captured_at) into v_read
    from public.black_money_signup_snapshots s
   where s.server_id = v_server;

  select a.player_id into v_stranger
    from jsonb_to_recordset(p_assignments) as a(player_id uuid)
   where not exists (
     select 1 from public.black_money_signup_snapshots s
      where s.server_id = v_server
        and s.captured_at = v_read
        and s.player_id = a.player_id
        and s.team_index = v_plan.team_index
        and s.state = 1)
   limit 1;
  if v_stranger is not null then
    raise exception 'only a starter of this team can be placed (player %)', v_stranger
      using errcode = '22023';
  end if;

  delete from public.bgb_plan_assignments where plan_id = p_plan_id;
  insert into public.bgb_plan_assignments (plan_id, objective_key, player_id, role, ordinal)
  select p_plan_id, a.objective_key, a.player_id, coalesce(a.role, ''), coalesce(a.ordinal, 0)
    from jsonb_to_recordset(p_assignments)
           as a(objective_key text, player_id uuid, role text, ordinal int);

  update public.bgb_plans
     set name = coalesce(btrim(p_name), name),
         note = coalesce(p_note, note),
         version = version + 1
   where plan_id = p_plan_id;
  perform internal.bgb_plan_stamp(p_plan_id);

  return (
    select jsonb_build_object(
             'version', p.version,
             'edited_at', p.edited_at,
             'edited_by_name', p.edited_by_name)
      from public.bgb_plans p
     where p.plan_id = p_plan_id);
end;
$$;

-- Make a plan the live one for its team; the previous live plan stops being
-- live. Not an edit: not version-checked, does not move the version.
create function public.make_bgb_plan_live(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.bgb_plans;
begin
  v_plan := internal.bgb_plan_lock(p_plan_id);
  if v_plan.deleted_at is not null then
    raise exception 'this plan was deleted' using errcode = 'P0002';
  end if;
  if v_plan.is_live then
    return;
  end if;
  update public.bgb_plans
     set is_live = false
   where alliance_id is not distinct from v_plan.alliance_id
     and team_index = v_plan.team_index
     and is_live
     and plan_id <> p_plan_id;
  update public.bgb_plans set is_live = true where plan_id = p_plan_id;
end;
$$;

-- Delete keeps the row for 30 days. Deleting twice is a no-op. A deleted plan
-- stops being live so it does not hold the team's one live slot while hidden.
create function public.delete_bgb_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.bgb_plans;
begin
  v_plan := internal.bgb_plan_lock(p_plan_id);
  if v_plan.deleted_at is not null then
    return;
  end if;
  update public.bgb_plans
     set deleted_at = now(),
         deleted_by = (select auth.uid()),
         deleted_by_name = internal.hive_actor_name(),
         is_live = false
   where plan_id = p_plan_id;
end;
$$;

-- Restore keeps the version and comes back NOT live: another plan may have
-- been made live since, and two live plans is the state where a member reads
-- the wrong objective.
create function public.restore_bgb_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.bgb_plans;
begin
  v_plan := internal.bgb_plan_lock(p_plan_id);
  if v_plan.deleted_at is not null then
    update public.bgb_plans
       set deleted_at = null, deleted_by = null, deleted_by_name = null
     where plan_id = p_plan_id;
    perform internal.bgb_plan_stamp(p_plan_id);
  end if;
  return (
    select jsonb_build_object(
             'version', p.version,
             'edited_at', p.edited_at,
             'edited_by_name', p.edited_by_name)
      from public.bgb_plans p
     where p.plan_id = p_plan_id);
end;
$$;

revoke all on function public.save_bgb_plan(uuid, int, text, text, jsonb) from public, anon;
revoke all on function public.make_bgb_plan_live(uuid) from public, anon;
revoke all on function public.delete_bgb_plan(uuid) from public, anon;
revoke all on function public.restore_bgb_plan(uuid) from public, anon;
grant execute on function public.save_bgb_plan(uuid, int, text, text, jsonb) to authenticated;
grant execute on function public.make_bgb_plan_live(uuid) to authenticated;
grant execute on function public.delete_bgb_plan(uuid) to authenticated;
grant execute on function public.restore_bgb_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The cleanup: 30 days, the same as the hive. Assignments go by cascade.

create function internal.purge_deleted_bgb_plans()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed int;
begin
  delete from public.bgb_plans where deleted_at < now() - interval '30 days';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function internal.purge_deleted_bgb_plans() from public, anon, authenticated;

select cron.schedule(
  'bgb-plan-purge-deleted',
  '43 3 * * *',
  $$ select internal.purge_deleted_bgb_plans(); $$);
