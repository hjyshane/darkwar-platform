-- 0272: the Gift Center now wants the player's own key.
--
-- Since 2026-10-10 code.php answers {"code":10006,"message":"system fail"} to
-- every request that lacks BOTH the `Usertoken: <uid>` header AND a `uuid`
-- parameter that belongs to that player (a random UUID, or someone else's, is
-- refused the same way). The page sends `code.php?uid=&code=&uuid=&fromkoc=`.
-- That uuid is not in anything the collector captures (searched the journal);
-- it is the player's own, so it has to be given to us per player.
--
--   * gift_player_keys: (alliance, player id) -> uuid. The uuid column is a
--     credential for that player's Gift Center login, so authenticated can
--     NOT read it (column-level grant leaves it out); only the key's presence
--     is visible, and only the sender (definer) and service_role read it.
--   * set_gift_player_keys(uids[], uuids[]): save or, with a null uuid, clear.
--   * the sender sends only for players with a key; claims queued for players
--     without one are failed with a plain reason (not retried, not spending
--     the Gift Center's patience), and are queued afresh by the next Claim
--     once the key is saved.
--   * gift_member_status gains `has_key`.

create table public.gift_player_keys (
  alliance_id uuid not null references public.alliances (alliance_id) on delete cascade
    default public.active_alliance(),
  game_uid bigint not null check (game_uid between 1000000000 and 9223372036854775807),
  player_uuid uuid not null,
  added_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (alliance_id, game_uid)
);

alter table public.gift_player_keys enable row level security;
revoke all on public.gift_player_keys from anon, authenticated;
-- Only WHO has a key is readable from the API, never the key.
grant select (alliance_id, game_uid, updated_at) on public.gift_player_keys to authenticated;
grant all on public.gift_player_keys to service_role;

create policy manager_read on public.gift_player_keys
  for select to authenticated
  using ((select public.has_permission('giftcodes.manage')));
create policy alliance_scope on public.gift_player_keys as restrictive
  for select to authenticated
  using (alliance_id is not distinct from (select public.active_alliance()));

comment on table public.gift_player_keys is
  'Per-player Gift Center key (0272). player_uuid is a credential: not readable '
  'from the API, only by the sender and the service role.';

create function public.set_gift_player_keys(p_uids bigint[], p_uuids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
  v_count int := 0;
  i int;
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  if v_alliance is null then
    raise exception 'no alliance on screen' using errcode = '22023';
  end if;
  if coalesce(array_length(p_uids, 1), 0) = 0
     or array_length(p_uids, 1) > 200
     or array_length(p_uids, 1) is distinct from array_length(p_uuids, 1) then
    raise exception 'give 1 to 200 player IDs, each with its key' using errcode = '22023';
  end if;

  for i in 1 .. array_length(p_uids, 1) loop
    if p_uids[i] is null or p_uids[i] < 1000000000 then
      raise exception 'a player ID is at least 10 digits' using errcode = '22023';
    end if;
    if p_uuids[i] is null then
      delete from public.gift_player_keys
       where alliance_id = v_alliance and game_uid = p_uids[i];
    else
      insert into public.gift_player_keys (alliance_id, game_uid, player_uuid, added_by)
      values (v_alliance, p_uids[i], p_uuids[i], auth.uid())
      on conflict (alliance_id, game_uid) do update
        set player_uuid = excluded.player_uuid, updated_at = now(), added_by = auth.uid()
        where public.gift_player_keys.alliance_id = v_alliance;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Queued claims for a player with no key cannot be sent: say so, once.
create function internal.gift_fail_keyless()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with failed as (
    update public.gift_code_claims c
       set status = 'failed', finished_at = now(),
           last_error = 'no key saved for this player'
     where c.status = 'queued'
       and not exists (
         select 1 from public.gift_player_keys k
          where k.alliance_id = c.alliance_id and k.game_uid = c.game_uid)
    returning 1
  )
  select count(*)::int into v_count from failed;
  return v_count;
end;
$$;

revoke execute on function internal.gift_fail_keyless() from public, anon, authenticated;

drop function internal.gift_http_get(bigint, text);
create function internal.gift_http_get(p_uid bigint, p_code text, p_key uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- plpgsql so the body is not resolved at creation (the pgTAP harness has no
  -- pg_net). `fromkoc` is sent empty, as the page does.
  return net.http_get(
    url := 'https://giftcenter.darkwar-survival.com/code.php',
    params := jsonb_build_object(
      'uid', p_uid::text, 'code', p_code, 'uuid', p_key::text, 'fromkoc', ''),
    headers := jsonb_build_object('Usertoken', p_uid::text, 'User-Agent', 'Mozilla/5.0'),
    timeout_milliseconds := 20000);
end;
$$;
revoke execute on function internal.gift_http_get(bigint, text, uuid) from public, anon, authenticated;

create or replace function internal.gift_send_next()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r internal.gift_runner%rowtype;
  v_claim record;
  v_request bigint;
begin
  select * into r from internal.gift_runner for update;
  if not r.enabled
     or (r.paused_until is not null and r.paused_until > now())
     or (r.last_sent_at is not null
         and r.last_sent_at > now() - make_interval(secs => r.min_interval_seconds)) then
    return 0;
  end if;

  -- One request in the air at a time.
  if exists (select 1 from internal.gift_inflight
             where sent_at > now() - interval '2 minutes') then
    return 0;
  end if;

  select c.claim_id, c.game_uid, g.code, k.player_uuid into v_claim
  from public.gift_code_claims c
  join public.gift_codes g on g.code_id = c.code_id
  join public.gift_player_keys k
    on k.alliance_id = c.alliance_id and k.game_uid = c.game_uid
  where c.status = 'queued'
    and c.next_attempt_at <= now()
    and g.status in ('unverified', 'working')
  order by c.created_at
  limit 1
  for update of c skip locked;
  if not found then
    return 0;
  end if;

  v_request := internal.gift_http_get(v_claim.game_uid, v_claim.code, v_claim.player_uuid);
  update public.gift_code_claims
     set status = 'running', started_at = now(), attempt_count = attempt_count + 1
   where claim_id = v_claim.claim_id;
  insert into internal.gift_inflight (claim_id, request_id) values (v_claim.claim_id, v_request);
  update internal.gift_runner set last_sent_at = now() where singleton;
  return 1;
end;
$$;

create or replace function internal.gift_settle()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_verdict record;
  v_settled int := 0;
begin
  perform internal.gift_fail_keyless();

  -- A dead code: nothing still queued for it is worth a request.
  update public.gift_code_claims c
     set status = 'cancelled', finished_at = now()
    from public.gift_codes g
   where g.code_id = c.code_id and c.status = 'queued' and g.status in ('expired', 'invalid');

  for v_row in
    select f.claim_id, r.status_code, r.content, r.timed_out, r.error_msg
    from internal.gift_inflight f
    join net._http_response r on r.id = f.request_id
  loop
    select * into v_verdict
    from internal.gift_classify(v_row.status_code, v_row.content, v_row.timed_out, v_row.error_msg);
    perform internal.gift_apply_answer(v_row.claim_id, v_verdict.kind, v_verdict.raw, v_verdict.error);
    v_settled := v_settled + 1;
  end loop;

  -- A request whose answer never turned up (pg_net trims its table): the pair
  -- goes back to the queue as a non-answer rather than waiting forever.
  for v_row in
    select f.claim_id from internal.gift_inflight f
    where f.sent_at < now() - interval '3 minutes'
  loop
    perform internal.gift_apply_answer(
      v_row.claim_id, 'retry', jsonb_build_object('error', 'no answer recorded'),
      'no answer recorded by pg_net');
    v_settled := v_settled + 1;
  end loop;
  return v_settled;
end;
$$;

drop function public.gift_member_status();
create function public.gift_member_status()
returns table (
  game_uid bigint,
  name text,
  excluded boolean,
  claims jsonb,
  extra boolean,
  has_key boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.game_uid,
         p.name,
         exists (select 1 from public.gift_claim_exclusions x
                  where x.alliance_id = (select public.active_alliance())
                    and x.game_uid = p.game_uid),
         coalesce((select jsonb_object_agg(c.code_id::text, c.status)
                     from public.gift_code_claims c
                    where c.alliance_id = (select public.active_alliance())
                      and c.game_uid = p.game_uid),
                  '{}'::jsonb),
         p.extra,
         exists (select 1 from public.gift_player_keys k
                  where k.alliance_id = (select public.active_alliance())
                    and k.game_uid = p.game_uid)
    from (
      select r.game_uid, r.name, false as extra
        from public.alliance_roster_latest r
       where r.alliance_id = (select public.active_alliance())
      union all
      select e.game_uid, coalesce(e.label, 'UID ' || e.game_uid::text), true
        from public.gift_extra_players e
       where e.alliance_id = (select public.active_alliance())
         and not exists (
           select 1 from public.alliance_roster_latest r
            where r.alliance_id = e.alliance_id and r.game_uid = e.game_uid)
    ) p
   order by p.extra, p.name;
$$;

revoke all on function public.set_gift_player_keys(bigint[], uuid[]) from public, anon, authenticated;
revoke all on function public.gift_member_status() from public, anon, authenticated;
revoke execute on function internal.gift_send_next() from public, anon, authenticated;
revoke execute on function internal.gift_settle() from public, anon, authenticated;
grant execute on function public.set_gift_player_keys(bigint[], uuid[]) to authenticated, service_role;
grant execute on function public.gift_member_status() to authenticated, service_role;
