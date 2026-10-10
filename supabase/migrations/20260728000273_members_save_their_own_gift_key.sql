-- 0273: a member saves their OWN Gift Center key.
--
-- Since 2026-10-10 the Gift Center needs the player's own key (0272). It is a
-- login token for that player's store account, so nobody should be collecting
-- other people's: this lets an account holder save the key of a character THEY
-- hold (user_players, 0193) and nothing else, and take it away again.
--
--   * my_gift_keys(): my characters and whether a key is saved for each. Never
--     the key itself.
--   * save_my_gift_key(game_uid, uuid) / remove_my_gift_key(game_uid): only for
--     a character linked to the calling account, in the alliance on screen.
--
-- No giftcodes.manage needed: a member is saving something that is theirs.
-- Every UPDATE/DELETE has a WHERE (hosted pg_safeupdate, 0253).

create function public.my_gift_keys()
returns table (
  game_uid bigint,
  name text,
  has_key boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.game_uid,
         p.current_name,
         k.game_uid is not null,
         k.updated_at
    from public.user_players up
    join public.players p on p.player_id = up.player_id
    left join public.gift_player_keys k
           on k.game_uid = p.game_uid
          and k.alliance_id is not distinct from (select public.active_alliance())
   where up.user_id = auth.uid()
   order by p.current_name;
$$;

create function public.save_my_gift_key(p_game_uid bigint, p_uuid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if v_alliance is null then
    raise exception 'no alliance on screen' using errcode = '22023';
  end if;
  if p_uuid is null then
    raise exception 'a key is required' using errcode = '22023';
  end if;
  -- Only a character linked to THIS account.
  if not exists (
    select 1
      from public.user_players up
      join public.players p on p.player_id = up.player_id
     where up.user_id = auth.uid() and p.game_uid = p_game_uid
  ) then
    raise exception 'that character is not linked to your account' using errcode = '42501';
  end if;

  insert into public.gift_player_keys (alliance_id, game_uid, player_uuid, added_by)
  values (v_alliance, p_game_uid, p_uuid, auth.uid())
  on conflict (alliance_id, game_uid) do update
    set player_uuid = excluded.player_uuid, updated_at = now(), added_by = auth.uid()
    where public.gift_player_keys.alliance_id = v_alliance;
end;
$$;

create function public.remove_my_gift_key(p_game_uid bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.user_players up
      join public.players p on p.player_id = up.player_id
     where up.user_id = auth.uid() and p.game_uid = p_game_uid
  ) then
    raise exception 'that character is not linked to your account' using errcode = '42501';
  end if;

  -- Wherever it was saved: the person asking is the owner of the key.
  delete from public.gift_player_keys
   where game_uid = p_game_uid;
  -- And what was still waiting to be sent with it is not sent.
  update public.gift_code_claims
     set status = 'cancelled', finished_at = now()
   where game_uid = p_game_uid and status = 'queued';
end;
$$;

revoke all on function public.my_gift_keys() from public, anon, authenticated;
revoke all on function public.save_my_gift_key(bigint, uuid) from public, anon, authenticated;
revoke all on function public.remove_my_gift_key(bigint) from public, anon, authenticated;
grant execute on function public.my_gift_keys() to authenticated, service_role;
grant execute on function public.save_my_gift_key(bigint, uuid) to authenticated, service_role;
grant execute on function public.remove_my_gift_key(bigint) to authenticated, service_role;

comment on function public.save_my_gift_key(bigint, uuid) is
  'Saves the Gift Center key of a character linked to the calling account (0273). '
  'The key is a store login token: write-only, never readable from the API.';
