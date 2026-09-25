-- 0165: saying which character you are links you to it, now.
--
-- 0068 built claims as a REQUEST an admin decides, and 0066's rule behind it
-- was that self-service linking would make the gate decorative. That gate was
-- decorative anyway: nobody approved anything. Members picked a character, saw
-- "an officer will confirm it", and waited for a confirmation that never came —
-- so the feature read as broken while behaving exactly as designed.
--
-- WHAT THIS COSTS, stated rather than glossed. `app_users.player_id` is what
-- opens a player's own history to an account (0066), so a member may now claim
-- to be the strongest member of the alliance and read that member's history.
-- The mitigations are that everybody here redeemed a join code to get in, that
-- the claim is recorded with who made it, and that an admin can move the link
-- afterwards on the members screen — which is the same screen that could always
-- move it. That trade was made deliberately.
--
-- `approve_player_claim` is untouched. A claim that arrives pending — from an
-- older client, or from a member the check below refused — still has its path.

create function public.claim_player(p_player_id uuid)
returns public.player_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claim public.player_claims;
  v_taken uuid;
begin
  if v_uid is null then
    raise exception 'sign in to say which character you are' using errcode = '42501';
  end if;

  -- Members and above. A viewer has not been admitted to the alliance, and
  -- linking them to a member's history is the one thing this must not do.
  if public.current_app_role() not in ('member', 'officer', 'admin') then
    raise exception 'members only' using errcode = '42501';
  end if;

  if not exists (select 1 from public.players where player_id = p_player_id) then
    raise exception 'no such player' using errcode = 'P0002';
  end if;

  -- The same check `approve_player_claim` makes, and for the same reason: 0066's
  -- partial unique index would raise this anyway, but as a 23505 with an index
  -- name in it. Somebody picking a character deserves to be told that it is
  -- already spoken for rather than shown a constraint.
  select user_id into v_taken from public.app_users
  where player_id = p_player_id and user_id <> v_uid;

  if v_taken is not null then
    raise exception 'that player is already linked to another account'
      using errcode = '23505';
  end if;

  update public.app_users set player_id = p_player_id where user_id = v_uid;

  -- Recorded as decided, by the person it is about. The audit trail keeps its
  -- shape — every claim still says who settled it and when — and the row reads
  -- honestly: this one was settled by the claimant, because that is the rule now.
  insert into public.player_claims as pc
    (user_id, player_id, status, decided_at, decided_by)
  values (v_uid, p_player_id, 'approved', now(), v_uid)
  on conflict (user_id) do update
    set player_id = excluded.player_id,
        status = 'approved',
        note = null,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by
  returning * into v_claim;

  return v_claim;
end;
$$;

comment on function public.claim_player(uuid) is
  'Link the calling account to a player, immediately. Members and above; '
  'refuses a player another account already holds. An admin can still move '
  'the link afterwards on the members screen.';

grant execute on function public.claim_player(uuid) to authenticated;
