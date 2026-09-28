-- 0193: a role belongs to an alliance, and an account can be several players.
--
-- Phase 2 of docs/superpowers/plans/2026-09-28-multi-alliance.md, database
-- half. With one pinned alliance (production until phase 5) every answer
-- below is the answer it was before; what changes is that the answers are
-- now computed per alliance.
--
-- THE ACTIVE ALLIANCE. The dashboard sends `x-alliance-id` on every request.
-- `active_alliance()` honours it only for an own alliance the caller belongs
-- to (or any own alliance, for an admin); anything else falls back. So the
-- header selects between alliances you are in and never opens one you are not.
--
-- current_app_role() is the one function ~100 policies call. It now answers
-- "your role in the active alliance":
--
--   admin / service roles   global, straight from app_users, as before
--   has memberships         the membership in the active alliance, or viewer
--   has none                app_users.role, as before
--
-- The last line is the compatibility line. A fresh install with nothing
-- pinned has no memberships at all (0192's mirror needs a pin to know where
-- to put one), and neither does any pgTAP fixture that makes a member without
-- pinning an alliance. They keep working exactly as they did.
--
-- PLAYERS. app_users.player_id was one player per account (0066). A person
-- in two alliances plays two characters, and one person may run alts in the
-- same alliance, so `user_players` holds any number — while each player
-- still belongs to at most one account. app_users.player_id stays as the
-- account's DISPLAY player (six views name authors through it) and is kept
-- in user_players by trigger, so an admin moving it on the members screen
-- still moves the link.

-- ---------------------------------------------------------------------------
-- Players.

create table public.user_players (
  -- The key is the player: one account per player, any number per account.
  player_id uuid primary key references public.players (player_id) on delete cascade,
  user_id uuid not null references public.app_users (user_id) on delete cascade,
  created_at timestamptz not null default now()
);

create index user_players_user_idx on public.user_players (user_id);

comment on table public.user_players is
  'Which players an account is. Many per account (a character per alliance, '
  'or alts); one account per player. Opens each player''s own history to the '
  'account (0066). app_users.player_id is the display player and is mirrored '
  'in here by trigger.';

alter table public.user_players enable row level security;
grant select on public.user_players to authenticated;
grant all on public.user_players to service_role;

create policy own_or_manager_read on public.user_players
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_permission('members.manage')));

insert into public.user_players (player_id, user_id)
select player_id, user_id from public.app_users where player_id is not null
on conflict (player_id) do nothing;

create function public.app_users_mirror_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.player_id is not null
     and old.player_id is distinct from new.player_id then
    delete from public.user_players
    where user_id = new.user_id and player_id = old.player_id;
  end if;

  if new.player_id is not null then
    if exists (select 1 from public.user_players
                where player_id = new.player_id and user_id <> new.user_id) then
      raise exception 'that player is already linked to another account'
        using errcode = '23505';
    end if;
    insert into public.user_players (player_id, user_id)
    values (new.player_id, new.user_id)
    on conflict (player_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.app_users_mirror_player() from public, anon, authenticated;

create trigger app_users_mirror_player
  after insert or update of player_id on public.app_users
  for each row execute function public.app_users_mirror_player();

create function public.linked_player_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select player_id from public.user_players where user_id = (select auth.uid())
$$;

revoke all on function public.linked_player_ids() from public;
grant execute on function public.linked_player_ids() to authenticated;

comment on function public.linked_player_ids() is
  'Every player the caller is. Empty for an unlinked account, which matches '
  'nothing — the same deny-by-default linked_player_id() gave with null.';

-- 0066's gate, reading the set. Uncorrelated, so it is evaluated once per
-- statement like the (SELECT ...) wrapping 0179 gave the other calls.
drop policy own_or_officer_read on public.alliance_member_snapshots;
create policy own_or_officer_read on public.alliance_member_snapshots
  for select to authenticated
  using (
    (select public.current_app_role()) in ('officer', 'admin')
    or player_id in (select public.linked_player_ids())
  );

-- ---------------------------------------------------------------------------
-- The active alliance and the role in it.

create function public.active_alliance()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_header text;
  v_pick uuid;
  v_primary uuid := public.primary_own_alliance();
begin
  -- PostgREST puts the request headers here, lower-cased, as JSON. Absent
  -- outside a request (psql, cron, realtime), which is simply "no header".
  v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-alliance-id';

  if v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_pick := v_header::uuid;
    if exists (select 1 from public.alliances where alliance_id = v_pick and is_own)
       and (exists (select 1 from public.alliance_memberships
                     where user_id = v_uid and alliance_id = v_pick)
            or exists (select 1 from public.app_users
                        where user_id = v_uid and role = 'admin')) then
      return v_pick;
    end if;
  end if;

  -- No usable header: the primary alliance if you are in it, else the first
  -- one you joined, else the primary for everybody else.
  if v_uid is not null then
    if exists (select 1 from public.alliance_memberships
                where user_id = v_uid and alliance_id = v_primary) then
      return v_primary;
    end if;
    select alliance_id into v_pick
    from public.alliance_memberships
    where user_id = v_uid
    order by created_at, alliance_id
    limit 1;
    if v_pick is not null then
      return v_pick;
    end if;
  end if;

  return v_primary;
end;
$$;

revoke all on function public.active_alliance() from public;
grant execute on function public.active_alliance() to anon, authenticated, service_role;

comment on function public.active_alliance() is
  'The own alliance this request is about: the x-alliance-id header when the '
  'caller belongs to it (admins: any own alliance), else the primary alliance '
  'if the caller is in it, else their first membership, else the primary. '
  'A header naming an alliance the caller is not in is ignored, not obeyed.';

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
              when u.role in ('admin', 'collector_service', 'analyst_service') then u.role
              when exists (select 1 from public.alliance_memberships m
                            where m.user_id = u.user_id)
                then coalesce(
                  (select m.role from public.alliance_memberships m
                    where m.user_id = u.user_id
                      and m.alliance_id = public.active_alliance()),
                  'viewer'::public.app_role)
              else u.role
            end
       from public.app_users u
      where u.user_id = (select auth.uid())),
    'viewer'::public.app_role)
$$;

comment on function public.current_app_role() is
  'The caller''s role for this request. Admin and the service roles are '
  'global. Otherwise the membership role in active_alliance(), or viewer if '
  'the caller belongs elsewhere only. An account with no memberships at all '
  'falls back to app_users.role, which is every account on an install with '
  'no pinned alliance.';

-- ---------------------------------------------------------------------------
-- Writing memberships.
--
-- One RPC for grant, change and revoke, because they are one decision on
-- one screen. An officer manages the alliance they are viewing; an admin
-- manages any. For the primary alliance it writes app_users.role and lets
-- 0192's mirror follow, so the legacy members screen and this agree.

create function public.set_membership(p_user uuid, p_alliance uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean := public.current_app_role() = 'admin';
  v_target public.app_role;
begin
  if not public.has_permission('members.manage') then
    raise exception 'not allowed to manage members' using errcode = '42501';
  end if;
  if not v_is_admin and p_alliance is distinct from public.active_alliance() then
    raise exception 'officers manage the alliance they are viewing' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('member', 'officer') then
    raise exception 'a membership is member or officer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.alliances where alliance_id = p_alliance and is_own) then
    raise exception 'not one of our alliances' using errcode = 'P0002';
  end if;

  select role into v_target from public.app_users where user_id = p_user;
  if v_target is null then
    if not exists (select 1 from auth.users where id = p_user) then
      raise exception 'no such account' using errcode = 'P0002';
    end if;
    insert into public.app_users (user_id, role) values (p_user, 'viewer');
    v_target := 'viewer';
  end if;

  -- Admin and the service roles are global and never hold a membership;
  -- writing one would be a row nothing reads and nothing cleans up.
  if v_target in ('admin', 'collector_service', 'analyst_service') then
    raise exception 'that account''s role is global, not per alliance' using errcode = '22023';
  end if;

  if p_alliance = public.primary_own_alliance() then
    update public.app_users set role = coalesce(p_role, 'viewer') where user_id = p_user;
  elsif p_role is null then
    delete from public.alliance_memberships
    where user_id = p_user and alliance_id = p_alliance;
  else
    insert into public.alliance_memberships (user_id, alliance_id, role)
    values (p_user, p_alliance, p_role)
    on conflict (user_id, alliance_id) do update set role = excluded.role;
  end if;
end;
$$;

revoke all on function public.set_membership(uuid, uuid, public.app_role) from public;
grant execute on function public.set_membership(uuid, uuid, public.app_role) to authenticated;

comment on function public.set_membership(uuid, uuid, public.app_role) is
  'Grant, change (member/officer) or revoke (null) an account''s membership '
  'of one own alliance. members.manage, and an officer only for the alliance '
  'they are viewing; admin for any. Creates the app_users row if needed.';

-- ---------------------------------------------------------------------------
-- Join codes admit you to the code's alliance.
--
-- Same body as 0021 in every respect the header comment of that file argues
-- for — throttle first, one null for every bad code, returned not raised,
-- never grants admin, never downgrades — with "never downgrades" now meaning
-- "does nothing if you already belong to THIS alliance".

create or replace function public.redeem_join_code(p_code text)
returns public.app_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.app_role;
  v_code_id uuid;
  v_alliance uuid;
  v_current public.app_role;
  v_failed int;
  v_window_start timestamptz;
begin
  if v_uid is null then
    raise exception 'sign in before redeeming a code' using errcode = '28000';
  end if;

  select failed_count, first_failed_at into v_failed, v_window_start
  from public.join_code_attempts where user_id = v_uid;

  if v_failed is not null and v_window_start > now() - interval '1 hour' and v_failed >= 5 then
    raise exception 'too many attempts; try again later' using errcode = '54000';
  end if;

  select code_id, grants_role, coalesce(alliance_id, public.primary_own_alliance())
    into v_code_id, v_role, v_alliance
  from public.join_codes
  where code = p_code
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and (max_uses is null or used_count < max_uses)
  for update;

  if v_code_id is null or v_role not in ('member', 'officer') then
    insert into public.join_code_attempts as a (user_id, failed_count)
    values (v_uid, 1)
    on conflict (user_id) do update
    set failed_count = case
          when a.first_failed_at > now() - interval '1 hour' then a.failed_count + 1
          else 1
        end,
        first_failed_at = case
          when a.first_failed_at > now() - interval '1 hour' then a.first_failed_at
          else now()
        end,
        last_failed_at = now();
    return null;
  end if;

  select role into v_current from public.app_users where user_id = v_uid;

  if v_current in ('admin', 'collector_service', 'analyst_service') then
    return v_current;
  end if;

  if v_alliance is null or v_alliance = public.primary_own_alliance() then
    -- The pinned alliance (or no pin at all): 0021's path, and 0192's mirror
    -- turns the role into a membership.
    if v_current is null then
      insert into public.app_users (user_id, role) values (v_uid, v_role);
    elsif v_current = 'viewer' then
      update public.app_users set role = v_role where user_id = v_uid;
    else
      return v_current;
    end if;
  else
    if exists (select 1 from public.alliance_memberships
                where user_id = v_uid and alliance_id = v_alliance) then
      return (select role from public.alliance_memberships
               where user_id = v_uid and alliance_id = v_alliance);
    end if;
    if v_current is null then
      insert into public.app_users (user_id, role) values (v_uid, 'viewer');
    end if;
    insert into public.alliance_memberships (user_id, alliance_id, role)
    values (v_uid, v_alliance, v_role);
  end if;

  update public.join_codes set used_count = used_count + 1 where code_id = v_code_id;
  delete from public.join_code_attempts where user_id = v_uid;

  return v_role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claiming players, now more than one.

create or replace function public.claim_player(p_player_id uuid)
returns public.player_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claim public.player_claims;
begin
  if v_uid is null then
    raise exception 'sign in to say which character you are' using errcode = '42501';
  end if;

  if public.current_app_role() not in ('member', 'officer', 'admin') then
    raise exception 'members only' using errcode = '42501';
  end if;

  if not exists (select 1 from public.players where player_id = p_player_id) then
    raise exception 'no such player' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.user_players
              where player_id = p_player_id and user_id <> v_uid)
     or exists (select 1 from public.app_users
                 where player_id = p_player_id and user_id <> v_uid) then
    raise exception 'that player is already linked to another account'
      using errcode = '23505';
  end if;

  insert into public.user_players (player_id, user_id)
  values (p_player_id, v_uid)
  on conflict (player_id) do nothing;

  -- The first player claimed becomes the one the account is shown as.
  update public.app_users set player_id = p_player_id
  where user_id = v_uid and player_id is null;

  -- player_claims stays one row per account: the latest claim, for the
  -- admin screen's audit. user_players is what the account IS.
  insert into public.player_claims as pc
    (user_id, player_id, status, decided_at, decided_by, alliance_id)
  values (v_uid, p_player_id, 'approved', now(), v_uid, public.active_alliance())
  on conflict (user_id) do update
    set player_id = excluded.player_id,
        status = 'approved',
        note = null,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by,
        alliance_id = excluded.alliance_id
  returning * into v_claim;

  return v_claim;
end;
$$;

comment on function public.claim_player(uuid) is
  'Add a player to the calling account, immediately. Members and above; '
  'refuses a player another account already holds. Any number per account; '
  'the first becomes the display player.';

create function public.unlink_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  delete from public.user_players where user_id = v_uid and player_id = p_player_id;

  -- If that was the display player, show the account as another of its
  -- players, or as nobody.
  update public.app_users
  set player_id = (select up.player_id from public.user_players up
                    where up.user_id = v_uid order by up.created_at limit 1)
  where user_id = v_uid and player_id = p_player_id;
end;
$$;

revoke all on function public.unlink_player(uuid) from public;
grant execute on function public.unlink_player(uuid) to authenticated;

comment on function public.unlink_player(uuid) is
  'Remove one of your own players from your account. Only ever your own.';

-- ---------------------------------------------------------------------------
-- The door: who is waiting, and for which alliance.
--
-- A new account now says which alliance it is joining, stored in its own
-- auth user metadata (client-writable, and harmless: it is a request). 0123's body, plus that column, plus a narrower gate: an
-- officer sees the people waiting for the alliance they are viewing; an admin
-- sees everybody; dw-notify still sees everybody. The new column goes last so
-- the view can be replaced in place.

create or replace view public.pending_access
with (security_invoker = false) as
select
  a.id as user_id,
  a.created_at,
  a.last_sign_in_at,
  case
    when a.raw_user_meta_data ->> 'alliance_id'
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (a.raw_user_meta_data ->> 'alliance_id')::uuid
  end as requested_alliance_id
from auth.users a
left join public.app_users u on u.user_id = a.id
where u.user_id is null
  and (
    (public.has_permission('members.manage')
      and (public.current_app_role() = 'admin'
           or coalesce(
                case
                  when a.raw_user_meta_data ->> 'alliance_id'
                       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then (a.raw_user_meta_data ->> 'alliance_id')::uuid
                end,
                public.primary_own_alliance()) = public.active_alliance()))
    or public.is_service_request());

alter view public.pending_access set (security_barrier = on);
revoke all on public.pending_access from anon;
grant select on public.pending_access to authenticated;

-- ---------------------------------------------------------------------------
-- The switcher's list: which own alliances may this caller view?

create function public.my_alliances()
returns table (alliance_id uuid, name text, code text, server_id int, role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select a.alliance_id, a.current_name, a.current_code, a.server_id,
         case when u.role = 'admin' then 'admin'::public.app_role else m.role end
  from public.alliances a
  left join public.app_users u on u.user_id = (select auth.uid())
  left join public.alliance_memberships m
    on m.alliance_id = a.alliance_id and m.user_id = (select auth.uid())
  where a.is_own
    and (u.role = 'admin' or m.user_id is not null
         -- No memberships at all: the legacy account on a single-alliance
         -- install is in the one alliance there is.
         or (u.role in ('member', 'officer')
             and not exists (select 1 from public.alliance_memberships x
                              where x.user_id = u.user_id)))
  order by a.alliance_id = public.primary_own_alliance() desc, a.current_name
$$;

revoke all on function public.my_alliances() from public;
grant execute on function public.my_alliances() to authenticated;

comment on function public.my_alliances() is
  'The own alliances the caller may switch between, with their role in each. '
  'Admins get every own alliance. Primary first. Drives the switcher button.';

-- The alliance a new account asks to join. Signed in but not yet admitted,
-- so it cannot read alliances; this is the one thing it needs from there.
-- NOT granted to anon: 0168 made anon hold nothing in public, and the choice
-- is made on the first signed-in screen rather than on the sign-up form.
create function public.joinable_alliances()
returns table (alliance_id uuid, name text, code text, server_id int)
language sql
stable
security definer
set search_path = ''
as $$
  select a.alliance_id, a.current_name, a.current_code, a.server_id
  from public.alliances a
  where a.is_own
  order by a.alliance_id = public.primary_own_alliance() desc, a.current_name
$$;

revoke all on function public.joinable_alliances() from public;
grant execute on function public.joinable_alliances() to authenticated;
