-- 0068: a member says which character they are, and an admin decides.
--
-- 0066 added `app_users.player_id` and was explicit that a member must not
-- be able to set it: linking an account to a player is what opens that
-- player's history to them, so self-service linking would make the gate
-- decorative. It left the link as something an admin types on the members
-- screen, which works and does not scale — the admin has to already know
-- which account is whose, and the person who knows is the member.
--
-- So the member states it and the admin confirms it. A claim is a REQUEST
-- and grants nothing on its own; `app_users.player_id` still only ever
-- changes through an admin action. What this adds is that the admin is now
-- approving an answer instead of guessing one.
--
-- One row per account, not a log. A member who picked the wrong character
-- should be able to say so again, and the second answer is the one that
-- matters; keeping every attempt would mean the screen has to work out
-- which is current, which is the kind of thing that goes wrong quietly.
-- `decided_at`/`decided_by` keep the audit of the decision itself.
--
-- Not gated on a capability, for the same reason 0066 gave: this is who may
-- BE a player, not which screen is offered. A checkbox grid is one mis-click
-- from letting members link themselves to anybody.

create table public.player_claims (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Cascade rather than set null: a claim to a player who no longer exists
  -- is not a claim an admin can act on.
  player_id uuid not null references public.players (player_id) on delete cascade,
  status text not null default 'pending',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.app_users (user_id),
  constraint player_claims_status check (status in ('pending', 'approved', 'rejected'))
);

create index player_claims_pending_idx on public.player_claims (status, created_at)
  where status = 'pending';

create trigger player_claims_set_updated_at
  before update on public.player_claims
  for each row execute function public.set_updated_at();

comment on table public.player_claims is
  'A member''s statement of which player they are, pending an admin''s '
  'decision. Grants nothing: public.app_users.player_id still changes only '
  'through approve_player_claim(), which requires members.manage.';

alter table public.player_claims enable row level security;

-- Their own claim, and only their own. Not admin-visible-only: a member has
-- to be able to see that their claim is still pending, or the only feedback
-- is silence.
create policy self_read on public.player_claims
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Writing is insert and update of a PENDING row for yourself, and nothing
-- else. The `with check` on status is the load-bearing part: without it a
-- member could update their own row to 'approved' and the decision would be
-- theirs to make.
--
-- Members and better. A viewer cannot usefully claim anyway — 0065 closed
-- `players`, so they cannot see the roster to pick from — and the honest
-- order is sign up, redeem a code, then say who you are.
create policy self_claim on public.player_claims
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and public.current_app_role() in ('member', 'officer', 'admin')
  );

create policy self_reclaim on public.player_claims
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_app_role() in ('member', 'officer', 'admin')
  )
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
  );

create policy manage_read on public.player_claims
  for select to authenticated
  using (public.has_permission('members.manage'));

create policy manage_write on public.player_claims
  for all to authenticated
  using (public.has_permission('members.manage'))
  with check (public.has_permission('members.manage'));

grant select, insert, update on public.player_claims to authenticated;

-- The decision. SECURITY DEFINER because it writes app_users, which a member
-- may not touch, and because the uniqueness check below has to see rows the
-- caller cannot read.
create function public.approve_player_claim(p_user uuid)
returns public.player_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.player_claims;
  v_taken uuid;
begin
  if not public.has_permission('members.manage') then
    raise exception 'members.manage is required to decide a claim'
      using errcode = '42501';
  end if;

  select * into v_claim from public.player_claims
  where user_id = p_user and status = 'pending'
  for update;

  if v_claim.user_id is null then
    raise exception 'no pending claim for that account' using errcode = 'P0002';
  end if;

  -- 0066's partial unique index would raise this anyway, but a constraint
  -- violation surfaces as a 23505 with an index name in it. An admin
  -- deciding a claim deserves to be told that the character is already
  -- somebody else's.
  select user_id into v_taken from public.app_users
  where player_id = v_claim.player_id and user_id <> p_user;

  if v_taken is not null then
    raise exception 'that player is already linked to another account'
      using errcode = '23505';
  end if;

  update public.app_users set player_id = v_claim.player_id where user_id = p_user;

  update public.player_claims
  set status = 'approved', decided_at = now(), decided_by = (select auth.uid())
  where user_id = p_user
  returning * into v_claim;

  return v_claim;
end;
$$;

create function public.reject_player_claim(p_user uuid)
returns public.player_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.player_claims;
begin
  if not public.has_permission('members.manage') then
    raise exception 'members.manage is required to decide a claim'
      using errcode = '42501';
  end if;

  update public.player_claims
  set status = 'rejected', decided_at = now(), decided_by = (select auth.uid())
  where user_id = p_user and status = 'pending'
  returning * into v_claim;

  if v_claim.user_id is null then
    raise exception 'no pending claim for that account' using errcode = 'P0002';
  end if;

  -- Deliberately does NOT clear app_users.player_id. A rejected claim is a
  -- request refused, not a link removed; unlinking is its own action on the
  -- members screen.
  return v_claim;
end;
$$;

revoke all on function public.approve_player_claim(uuid) from public;
revoke all on function public.reject_player_claim(uuid) from public;
grant execute on function public.approve_player_claim(uuid) to authenticated;
grant execute on function public.reject_player_claim(uuid) to authenticated;

comment on function public.approve_player_claim(uuid) is
  'Link the account to the player it claimed. Requires members.manage, '
  'refuses a player already linked elsewhere, and is the only path by which '
  'a claim ever reaches app_users.player_id.';
