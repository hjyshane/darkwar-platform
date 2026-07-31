-- 0021: how an alliance member becomes a member.
--
-- current_app_role() reads public.app_users, and nothing creates a row
-- there. A new Supabase Auth account therefore falls through to the
-- 'viewer' default and sees none of what 0020 restricted — signing in
-- changed nothing. Roles could only be granted by an admin writing SQL,
-- which does not scale past a handful of people.
--
-- §6.2 describes the eventual flow: a one-time code delivered in-game,
-- matched against the sender's game_uid. That waits on a capture we do not
-- have (§5.3 — the in-game message receive command is unconfirmed), so this
-- is the interim: an admin issues a code out of band, a signed-in user
-- redeems it, and their role is set.
--
-- SECURITY NOTES, since this grants privilege:
--
--   * join_codes is readable by nobody but admins. Redemption goes through
--     a security-definer function, so a client never needs to see the table
--     to use a code. A readable code table would be the whole game.
--   * The function refuses to grant 'admin' or the service roles. The check
--     constraint says it too, so a hand-inserted row cannot widen it.
--   * Redemption never DOWNGRADES. Enum order is not privilege order here
--     (collector_service and analyst_service sort above admin), so the rule
--     is explicit rather than comparative: a code applies only to a user
--     who is currently 'viewer' or has no row at all.
--   * Failure is one message for every cause — wrong, expired, revoked,
--     exhausted. Distinguishing them tells an attacker which codes exist.
--   * Attempts are counted per user and capped, because a code short enough
--     to type is short enough to guess given unlimited tries.

create table public.join_codes (
  code_id uuid primary key default gen_random_uuid(),
  code text not null unique,
  grants_role public.app_role not null default 'member',
  max_uses int,
  used_count int not null default 0,
  expires_at timestamptz,
  note text,
  created_by uuid references public.app_users (user_id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- Belt and braces with the function's own check: no path to admin.
  constraint join_codes_grantable_role
    check (grants_role in ('member', 'officer')),
  constraint join_codes_max_uses_positive
    check (max_uses is null or max_uses > 0)
);

comment on table public.join_codes is
  'Out-of-band invitations. Never exposed to clients: redemption goes '
  'through public.redeem_join_code(), which is security definer.';

alter table public.join_codes enable row level security;

-- No grant to anon or authenticated at all. Admin reaches this through the
-- service key or a future admin screen; everyone else only ever touches the
-- function below.
create policy admin_all on public.join_codes
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- One row per user, so a wrong guess costs something.
create table public.join_code_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  failed_count int not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now()
);

alter table public.join_code_attempts enable row level security;
-- Deliberately no policy: only the security-definer function touches this.

create function public.redeem_join_code(p_code text)
returns public.app_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.app_role;
  v_code_id uuid;
  v_current public.app_role;
  v_failed int;
  v_window_start timestamptz;
begin
  if v_uid is null then
    raise exception 'sign in before redeeming a code' using errcode = '28000';
  end if;

  -- Throttle first, so a locked-out caller learns nothing about the code.
  select failed_count, first_failed_at into v_failed, v_window_start
  from public.join_code_attempts where user_id = v_uid;

  if v_failed is not null and v_window_start > now() - interval '1 hour' and v_failed >= 5 then
    raise exception 'too many attempts; try again later' using errcode = '54000';
  end if;

  select code_id, grants_role into v_code_id, v_role
  from public.join_codes
  where code = p_code
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and (max_uses is null or used_count < max_uses)
  for update;

  if v_code_id is null then
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
    -- One message for every cause: which codes exist is not the caller's
    -- business.
    raise exception 'that code is not valid' using errcode = '22023';
  end if;

  if v_role not in ('member', 'officer') then
    raise exception 'that code is not valid' using errcode = '22023';
  end if;

  select role into v_current from public.app_users where user_id = v_uid;

  if v_current is null then
    insert into public.app_users (user_id, role) values (v_uid, v_role);
  elsif v_current = 'viewer' then
    update public.app_users set role = v_role where user_id = v_uid;
  else
    -- Already member or better. Redeeming again is a no-op rather than a
    -- way to move sideways, and it does not burn a use.
    return v_current;
  end if;

  update public.join_codes set used_count = used_count + 1 where code_id = v_code_id;
  delete from public.join_code_attempts where user_id = v_uid;

  return v_role;
end;
$$;

revoke all on function public.redeem_join_code(text) from public;
grant execute on function public.redeem_join_code(text) to authenticated;

comment on function public.redeem_join_code(text) is
  'Exchange an invitation code for a role. Signed-in callers only; never '
  'grants admin, never downgrades, and reports every failure identically.';
