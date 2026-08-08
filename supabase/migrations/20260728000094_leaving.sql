-- 0094: leaving, and being removed.
--
-- Neither was possible. Nine foreign keys point at `app_users(user_id)` or
-- `auth.users(id)` with no `on delete` clause at all, so `delete from
-- app_users` raised 23503 the moment the account had ever issued an
-- invitation, decided a claim, written a notice or saved a setting — which is
-- to say, for every account worth removing. The handover called this
-- "`created_by` SET NULL"; `created_by` is three of the nine.
--
--   -> app_users(user_id)   refresh_jobs.requested_by, audit_logs.actor_user_id,
--                           join_codes.created_by, player_claims.decided_by
--   -> auth.users(id)       app_settings.updated_by, announcements.created_by,
--                           player_ranks.set_by, notification_channels.updated_by,
--                           guides.created_by
--
-- All nine become `set null`. The alternative is that the work somebody did
-- keeps them in the alliance forever, and 0080 already decided how to render
-- an author the database cannot name: `post_authors` falls through to
-- 'Unknown member'. A notice outliving its author is the normal case here,
-- not an anomaly.
--
-- WHAT LEAVING IS. The `app_users` row goes; the `auth.users` row stays. The
-- role then falls back to 'viewer' through `current_app_role()`, which is the
-- honest outcome: the person can still sign in and see the public dashboard,
-- and can be admitted again with a join code without making a second account.
-- Deleting the login is a different act, it needs the auth admin API rather
-- than SQL, and it is not what "left the alliance" means.
--
-- `favourites`, `post_reads` and `join_code_attempts` hang off `auth.users`
-- and are deliberately untouched. They are that person's own list and their
-- own read marks; someone who rejoins next week should not have to rebuild
-- them, and none of them expose anything to anybody else.
--
-- SUPERSEDES the reasoning in MembersSetting's `revoke`, which set the role
-- to 'viewer' and unlinked the character instead of deleting, on the grounds
-- that "deleting the app_users row would only make the next sign-in recreate
-- it as a viewer, which is where this puts them anyway". The end state is not
-- the same, in two ways that matter:
--
--   * A demoted row keeps `display_name` and `game_rank`. That is the same
--     shape of bug as `players.current_alliance_id`, where nobody cleared the
--     column and departed members kept their badge for good.
--   * Demotion leaves no record of the departure. `record_departure` below
--     writes one, with the name, before the name becomes unreachable.
--
-- And leaving voluntarily could not be built on demotion at all: `app_users`
-- is written under `members.manage`, which the person leaving does not have.

alter table public.refresh_jobs
  drop constraint refresh_jobs_requested_by_fkey,
  add constraint refresh_jobs_requested_by_fkey
    foreign key (requested_by) references public.app_users (user_id) on delete set null;

alter table public.audit_logs
  drop constraint audit_logs_actor_user_id_fkey,
  add constraint audit_logs_actor_user_id_fkey
    foreign key (actor_user_id) references public.app_users (user_id) on delete set null;

alter table public.join_codes
  drop constraint join_codes_created_by_fkey,
  add constraint join_codes_created_by_fkey
    foreign key (created_by) references public.app_users (user_id) on delete set null;

alter table public.player_claims
  drop constraint player_claims_decided_by_fkey,
  add constraint player_claims_decided_by_fkey
    foreign key (decided_by) references public.app_users (user_id) on delete set null;

alter table public.app_settings
  drop constraint app_settings_updated_by_fkey,
  add constraint app_settings_updated_by_fkey
    foreign key (updated_by) references auth.users (id) on delete set null;

alter table public.announcements
  drop constraint announcements_created_by_fkey,
  add constraint announcements_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

alter table public.player_ranks
  drop constraint player_ranks_set_by_fkey,
  add constraint player_ranks_set_by_fkey
    foreign key (set_by) references auth.users (id) on delete set null;

alter table public.notification_channels
  drop constraint notification_channels_updated_by_fkey,
  add constraint notification_channels_updated_by_fkey
    foreign key (updated_by) references auth.users (id) on delete set null;

alter table public.guides
  drop constraint guides_created_by_fkey,
  add constraint guides_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

-- Who left, recorded before the row that says who they were disappears.
--
-- `actor_user_id` is now `set null`, so an audit row about a departure loses
-- its actor the instant the departure happens — the one event where that
-- column is guaranteed to be useless. The name goes into `before`, which is
-- jsonb and holds text rather than a key, so it survives.
create function public.record_departure(p_user uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
begin
  select * into v_user from public.app_users where user_id = p_user;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, before)
  values (
    -- The person doing it, which for a removal is not the person leaving.
    (select auth.uid()),
    p_action,
    'app_users',
    p_user::text,
    jsonb_build_object(
      'display_name', v_user.display_name,
      'role', v_user.role,
      'player_id', v_user.player_id
    )
  );
end;
$$;

revoke all on function public.record_departure(uuid, text) from public;

-- Leaving, by the person leaving.
--
-- SECURITY DEFINER because it deletes from `app_users`, whose write policy is
-- `members.manage` — a member has no business editing that table in general
-- and every business removing their own row from it. The predicate is
-- `auth.uid()` and nothing else, so this cannot be pointed at anybody.
create function public.leave_alliance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_admins int;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_users where user_id = v_me) then
    -- Already gone. Not an error: the button was pressed twice, or in two
    -- tabs, and the state the caller wanted is the state they have.
    return;
  end if;

  -- The last admin cannot leave. Nobody else could admit a replacement, and
  -- 0045 already refuses to let an admin untick their own members.manage for
  -- the same reason: this is the one door with no lock on the inside.
  select count(*) into v_admins from public.app_users where role = 'admin';
  if v_admins = 1 and (select role from public.app_users where user_id = v_me) = 'admin' then
    raise exception 'the last admin cannot leave; make somebody else an admin first'
      using errcode = '23514';
  end if;

  perform public.record_departure(v_me, 'app_users.left');
  delete from public.player_claims where user_id = v_me;
  delete from public.app_users where user_id = v_me;
end;
$$;

revoke all on function public.leave_alliance() from public;
grant execute on function public.leave_alliance() to authenticated;

comment on function public.leave_alliance is
  'Give up your own access. The login survives and the role falls back to '
  'viewer; a join code admits you again.';

-- Removing somebody else.
--
-- `members.manage`, the same capability that admits them, sets their role and
-- decides their claim. Separate from leave_alliance() rather than one function
-- with an optional argument: the two have different callers, different
-- refusals, and an optional argument that defaults to "me" is one typo away
-- from an officer removing themselves.
create function public.remove_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if not public.has_permission('members.manage') then
    raise exception 'members.manage is required to remove a member'
      using errcode = '42501';
  end if;
  if p_user = v_me then
    -- Not a permission problem, so it gets its own sentence. Leaving is a
    -- decision about yourself and lives on your own screen, where the
    -- last-admin check is.
    raise exception 'use leave_alliance() to remove yourself'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.app_users where user_id = p_user) then
    return;
  end if;
  -- An officer cannot remove an admin. Without this, `members.manage` is a
  -- capability an admin can grant that takes the admin's own account away.
  if (select role from public.app_users where user_id = p_user) = 'admin'
     and public.current_app_role() <> 'admin' then
    raise exception 'only an admin can remove an admin' using errcode = '42501';
  end if;

  perform public.record_departure(p_user, 'app_users.removed');
  delete from public.player_claims where user_id = p_user;
  delete from public.app_users where user_id = p_user;
end;
$$;

revoke all on function public.remove_member(uuid) from public;
grant execute on function public.remove_member(uuid) to authenticated;

comment on function public.remove_member is
  'Take away another account''s access. Needs members.manage. Their login and '
  'their favourites survive; their posts lose their author.';
