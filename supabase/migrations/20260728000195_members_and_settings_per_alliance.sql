-- 0195: an officer manages their own alliance's people and settings, and
-- nothing else.
--
-- Phase 3b of docs/superpowers/plans/2026-09-28-multi-alliance.md.
--
-- THE HOLE THIS CLOSES. `app_users` has been writable by whoever holds
-- members.manage (0045), over every row, including the `role` column. While
-- only admins held that capability it did not matter. Per-alliance officers
-- (0193) are exactly the people an admin will want to give it to, and the
-- policy would then have let an officer of one alliance edit, remove or
-- promote the other alliance's members, or make themselves admin. Four
-- pieces, all no-ops for an admin and for a single-alliance install:
--
--   1. A restrictive policy: a non-admin sees and writes only accounts that
--      belong to the alliance being viewed (plus their own).
--   2. A guard trigger, because remove_member/leave_alliance are SECURITY
--      DEFINER and RLS never sees them: only an admin moves the admin role;
--      app_users.role (the PRIMARY alliance's role, via 0192's mirror) moves
--      only while viewing the primary; removing an account that also belongs
--      to another alliance is refused (take them out of this one instead).
--   3. app_user_directory narrows to the alliance being viewed and says what
--      each account is IN it.
--   4. leave_active_alliance(): someone in two alliances leaves one.
--
-- SETTINGS. The per-alliance ones (rank tiers, which carry the score
-- weights) get an override table beside app_settings. app_settings stays the
-- primary alliance's value AND the default for any alliance without its own,
-- so every existing reader — the rank build included — keeps reading exactly
-- what it read. Phase 4 moves those readers to alliance_setting().
-- Discord routing is per alliance too, but the notifier has to learn which
-- alliance each event belongs to first; that is its own change.

-- ---------------------------------------------------------------------------
-- 1. Settings.

create table public.alliance_settings (
  alliance_id uuid not null references public.alliances (alliance_id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  primary key (alliance_id, key),
  -- Only keys that are meant to differ between alliances. A shared setting
  -- written here would be silently ignored by every reader of app_settings.
  -- The same list is in save_alliance_setting(); add a key to both.
  constraint alliance_settings_known_key check (key in ('rank_tiers'))
);

comment on table public.alliance_settings is
  'Per-alliance overrides of app_settings keys. Absent means "same as '
  'app_settings", which is also the primary alliance''s value. Read through '
  'alliance_setting(); written through save_alliance_setting().';

alter table public.alliance_settings enable row level security;
grant select on public.alliance_settings to authenticated;
grant all on public.alliance_settings to service_role;

create policy member_read on public.alliance_settings
  for select to authenticated using (true);
create policy alliance_scope on public.alliance_settings as restrictive
  for all to authenticated
  using (alliance_id = (select public.active_alliance()))
  with check (alliance_id = (select public.active_alliance()));

create trigger alliance_settings_set_updated_at
  before update on public.alliance_settings
  for each row execute function public.set_updated_at();

create function public.alliance_setting(p_key text, p_alliance uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.value from public.alliance_settings s
      where s.key = p_key
        and s.alliance_id = coalesce(p_alliance, public.active_alliance())),
    (select a.value from public.app_settings a where a.key = p_key))
$$;

revoke all on function public.alliance_setting(text, uuid) from public;
grant execute on function public.alliance_setting(text, uuid) to authenticated, service_role;

comment on function public.alliance_setting(text, uuid) is
  'A setting as one alliance sees it: its own override, else app_settings. '
  'Defaults to the alliance being viewed.';

create function public.save_alliance_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
begin
  if not public.has_permission('settings.write') then
    raise exception 'changing settings requires settings.write' using errcode = '42501';
  end if;
  if p_key not in ('rank_tiers') then
    raise exception 'not a per-alliance setting' using errcode = '22023';
  end if;
  if p_value is null then
    raise exception 'a setting needs a value' using errcode = '22023';
  end if;

  -- The primary alliance's value IS app_settings: every reader not yet
  -- alliance-aware reads it there, and must keep seeing the primary's.
  if v_alliance is null or v_alliance = public.primary_own_alliance() then
    insert into public.app_settings (key, value, updated_by)
    values (p_key, p_value, (select auth.uid()))
    on conflict (key) do update
      set value = excluded.value, updated_by = excluded.updated_by;
  else
    insert into public.alliance_settings (alliance_id, key, value, updated_by)
    values (v_alliance, p_key, p_value, (select auth.uid()))
    on conflict (alliance_id, key) do update
      set value = excluded.value, updated_by = excluded.updated_by;
  end if;
end;
$$;

revoke all on function public.save_alliance_setting(text, jsonb) from public;
grant execute on function public.save_alliance_setting(text, jsonb) to authenticated;

comment on function public.save_alliance_setting(text, jsonb) is
  'Write a per-alliance setting for the alliance being viewed: app_settings '
  'for the primary, alliance_settings for any other. settings.write.';

-- ---------------------------------------------------------------------------
-- 2. Accounts belong somewhere.

create function public.account_in_view(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.alliance_memberships m
                  where m.user_id = p_user and m.alliance_id = public.active_alliance())
      -- An account with no membership anywhere (a viewer, or every account on
      -- an unpinned install) belongs to the primary alliance's screen.
      or (not exists (select 1 from public.alliance_memberships m where m.user_id = p_user)
          and public.primary_own_alliance() is not distinct from public.active_alliance())
$$;

revoke all on function public.account_in_view(uuid) from public;
grant execute on function public.account_in_view(uuid) to authenticated;

comment on function public.account_in_view(uuid) is
  'Whether an account belongs to the alliance being viewed: a membership '
  'there, or no membership anywhere while viewing the primary.';

create policy alliance_scope on public.app_users as restrictive
  for all to authenticated
  using (user_id = (select auth.uid())
         or (select public.current_app_role()) = 'admin'
         or public.account_in_view(user_id))
  with check (user_id = (select auth.uid())
              or (select public.current_app_role()) = 'admin'
              or public.account_in_view(user_id));

create function public.app_users_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_target uuid := coalesce(new.user_id, old.user_id);
  v_active uuid;
begin
  -- Only a browser request (PostgREST's `set local role authenticated`) is
  -- judged. Service key, cron, migrations and owner connections are not a
  -- person — including an owner connection still carrying a user's claims
  -- from earlier in the transaction, which is what 69_board_extras does after
  -- `reset role`. SECURITY DEFINER does not change the `role` setting.
  if v_uid is null
     or coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  v_admin := public.current_app_role() = 'admin';
  if v_admin then
    return coalesce(new, old);
  end if;
  v_active := public.active_alliance();

  if tg_op in ('INSERT', 'UPDATE') then
    -- Nobody but an admin makes or unmakes an admin (or a service role).
    if new.role in ('admin', 'collector_service', 'analyst_service')
       and (tg_op = 'INSERT' or old.role is distinct from new.role) then
      raise exception 'only an admin grants that role' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.role in ('admin', 'collector_service', 'analyst_service')
       and old.role is distinct from new.role then
      raise exception 'only an admin changes an admin' using errcode = '42501';
    end if;
    -- app_users.role is the primary alliance's role (0192 mirrors it). It
    -- moves while viewing the primary, or when somebody redeems their own
    -- way in (viewer -> member/officer, 0021's only shape).
    if tg_op = 'UPDATE' and old.role is distinct from new.role
       and v_active is distinct from public.primary_own_alliance()
       and not (v_target = v_uid and old.role = 'viewer'
                and new.role in ('member', 'officer')) then
      raise exception 'that role belongs to another alliance' using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE: leaving (yourself) or removal (somebody else).
  if v_target = v_uid then
    if (select count(*) from public.alliance_memberships where user_id = v_uid) > 1 then
      raise exception 'you are in more than one alliance; leave this one instead'
        using errcode = '42501';
    end if;
  elsif exists (select 1 from public.alliance_memberships m
                 where m.user_id = v_target
                   and m.alliance_id is distinct from v_active) then
    raise exception 'that account also belongs to another alliance; remove it from this one instead'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.app_users_guard() from public, anon, authenticated;

create trigger app_users_guard
  before insert or update or delete on public.app_users
  for each row execute function public.app_users_guard();

-- ---------------------------------------------------------------------------
-- 3. The directory, for the alliance on screen.
--
-- 0069's body, the members.manage gate kept, narrowed to account_in_view()
-- for anyone but an admin, and two columns appended: what the account is in
-- THIS alliance (admin shown as admin: it is global), and how many others
-- it is in. Definer stated
-- explicitly: 0187 had to put it back once already.

create or replace view public.app_user_directory
with (security_invoker = false) as
select
  u.user_id,
  u.role,
  u.game_rank,
  u.display_name,
  u.player_id,
  u.created_at,
  a.email,
  a.email_confirmed_at,
  a.last_sign_in_at,
  case
    when u.role = 'admin' then 'admin'::public.app_role
    when exists (select 1 from public.alliance_memberships x where x.user_id = u.user_id)
      then coalesce(
        (select m.role from public.alliance_memberships m
          where m.user_id = u.user_id and m.alliance_id = public.active_alliance()),
        'viewer'::public.app_role)
    else u.role
  end as alliance_role,
  -- How many OTHER alliances the account is in. Non-zero means "remove"
  -- has to mean "from this alliance" (set_membership), not remove_member,
  -- which the guard refuses for exactly that account.
  (select count(*)::int from public.alliance_memberships x
    where x.user_id = u.user_id
      and x.alliance_id is distinct from public.active_alliance()) as other_alliances
from public.app_users u
join auth.users a on a.id = u.user_id
where public.has_permission('members.manage')
  and (public.current_app_role() = 'admin' or public.account_in_view(u.user_id));

grant select on public.app_user_directory to authenticated;

-- Who is waiting to be let in to the alliance on screen, with the address
-- they signed up under — which pending_access deliberately leaves out, since
-- it feeds a Discord alert. Same gate the directory has for showing an email.
create function public.waiting_to_join()
returns table (user_id uuid, email text, created_at timestamptz,
               last_sign_in_at timestamptz, requested_alliance_id uuid)
language sql
stable
security definer
set search_path = ''
-- NOT built on pending_access. That view's gate ORs is_service_request(),
-- which reads current_user — and inside this definer function current_user
-- is the owner, so the gate would open for every caller and hand out every
-- waiting stranger's address. The predicate is restated here without it.
as $$
  with asked as (
    select a.id, a.email::text as email, a.created_at, a.last_sign_in_at,
           case
             when a.raw_user_meta_data ->> 'alliance_id'
                  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then (a.raw_user_meta_data ->> 'alliance_id')::uuid
           end as requested
    from auth.users a
    where not exists (select 1 from public.app_users u where u.user_id = a.id)
  )
  select q.id, q.email, q.created_at, q.last_sign_in_at, q.requested
  from asked q
  where (select auth.uid()) is not null
    and public.has_permission('members.manage')
    and (public.current_app_role() = 'admin'
         or coalesce(q.requested, public.primary_own_alliance()) = public.active_alliance())
  order by q.created_at
$$;

revoke all on function public.waiting_to_join() from public;
grant execute on function public.waiting_to_join() to authenticated;

comment on function public.waiting_to_join() is
  'Accounts with no app_users row, with the address they signed up under, '
  'for the members screen. members.manage; an officer sees only people asking '
  'for the alliance being viewed. Deliberately not a wrapper of '
  'pending_access, whose service disjunct is always true under definer.';

-- ---------------------------------------------------------------------------
-- 4. Leaving one alliance of several.

create function public.leave_active_alliance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_active uuid := public.active_alliance();
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  -- One alliance or none: leaving it is leaving, and 0094 already says what
  -- that means (the departure is recorded, the last admin cannot go).
  if (select count(*) from public.alliance_memberships where user_id = v_uid) <= 1 then
    perform public.leave_alliance();
    return;
  end if;

  if v_active = public.primary_own_alliance() then
    -- The primary's role lives on app_users; the mirror drops the membership.
    update public.app_users set role = 'viewer'
    where user_id = v_uid and role in ('member', 'officer');
  end if;
  delete from public.alliance_memberships
  where user_id = v_uid and alliance_id = v_active;
end;
$$;

revoke all on function public.leave_active_alliance() from public;
grant execute on function public.leave_active_alliance() to authenticated;

comment on function public.leave_active_alliance() is
  'Leave the alliance being viewed. In more than one: only that membership '
  'goes. In one or none: leave_alliance(), unchanged.';
