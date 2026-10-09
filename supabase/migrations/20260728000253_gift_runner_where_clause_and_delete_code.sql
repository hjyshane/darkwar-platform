-- 0253: the gift sender's switch works on the hosted database; and a code can be
-- deleted from the list.
--
-- 0252's runner functions updated the one-row `internal.gift_runner` with no
-- WHERE. Hosted Supabase loads pg_safeupdate for API sessions, which refuses an
-- UPDATE or DELETE without one ("UPDATE requires a WHERE clause"), so the
-- dashboard's Turn on / Turn off failed. Neither the pgTAP harness nor CI loads
-- that extension, which is why they passed. Every statement below now says
-- `where singleton`, and the test (254) checks that each one does.
--
-- delete_gift_code: removes this alliance's claims for the code, then the code
-- itself when no alliance has any claim left. Codes are global (0251), so one
-- alliance's officer must not erase another's history.

create or replace function internal.gift_apply_answer(
  p_claim_id uuid, p_kind text, p_raw jsonb, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.gift_code_claims%rowtype;
  v_nonanswers int;
begin
  select * into v_claim from public.gift_code_claims
  where claim_id = p_claim_id and status = 'running' for update;
  if not found then
    delete from internal.gift_inflight where claim_id = p_claim_id;
    return;
  end if;
  delete from internal.gift_inflight where claim_id = p_claim_id;

  if p_kind in ('done', 'already') then
    update public.gift_code_claims
       set status = p_kind, finished_at = now(), result = p_raw, last_error = null
     where claim_id = p_claim_id;
    if p_kind = 'done' then
      update public.gift_codes set status = 'working', checked_at = now()
       where code_id = v_claim.code_id;
    end if;
    update internal.gift_runner set consecutive_non_answers = 0 where singleton;

  elsif p_kind in ('expired', 'invalid') then
    update public.gift_code_claims
       set status = p_kind, finished_at = now(), result = p_raw
     where claim_id = p_claim_id;
    update public.gift_codes set status = p_kind, checked_at = now()
     where code_id = v_claim.code_id;
    update public.gift_code_claims
       set status = 'cancelled', finished_at = now()
     where code_id = v_claim.code_id and status = 'queued';
    update internal.gift_runner set consecutive_non_answers = 0 where singleton;

  elsif p_kind = 'stop' then
    -- Not an attempt: put back untouched, and switch the runner off until a
    -- person has looked.
    update public.gift_code_claims
       set status = 'queued', attempt_count = greatest(attempt_count - 1, 0),
           result = p_raw, last_error = p_error
     where claim_id = p_claim_id;
    perform internal.set_gift_runner(false, coalesce(p_error, 'the Gift Center asked to stop'));

  else  -- retry
    if v_claim.attempt_count >= 4 then
      update public.gift_code_claims
         set status = 'failed', finished_at = now(), result = p_raw, last_error = p_error
       where claim_id = p_claim_id;
    else
      update public.gift_code_claims
         set status = 'queued',
             next_attempt_at = now() + make_interval(
               secs => least(300 * power(2, v_claim.attempt_count - 1), 3600)),
             result = p_raw, last_error = p_error
       where claim_id = p_claim_id;
    end if;
    update internal.gift_runner
       set consecutive_non_answers = consecutive_non_answers + 1
     where singleton
    returning consecutive_non_answers into v_nonanswers;
    -- A run of non-answers: stop hammering a page that is telling us something.
    if v_nonanswers >= 5 then
      update internal.gift_runner
         set paused_until = now() + interval '15 minutes', consecutive_non_answers = 0
       where singleton;
    end if;
  end if;
end;
$$;

create or replace function internal.set_gift_runner(p_enabled boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_enabled then
    update internal.gift_runner
       set enabled = true, halted_reason = null, paused_until = null,
           consecutive_non_answers = 0, updated_at = now()
     where singleton;
    perform cron.schedule(
      'gift-runner', '5 seconds',
      $job$ select internal.gift_settle(), internal.gift_send_next(); $job$);
  else
    update internal.gift_runner
       set enabled = false, halted_reason = p_reason, updated_at = now()
     where singleton;
    begin
      perform cron.unschedule('gift-runner');
    exception when others then
      null;  -- not scheduled: already off
    end;
  end if;
end;
$$;

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

  select c.claim_id, c.game_uid, g.code into v_claim
  from public.gift_code_claims c
  join public.gift_codes g on g.code_id = c.code_id
  where c.status = 'queued'
    and c.next_attempt_at <= now()
    and g.status in ('unverified', 'working')
  order by c.created_at
  limit 1
  for update of c skip locked;
  if not found then
    return 0;
  end if;

  v_request := internal.gift_http_get(v_claim.game_uid, v_claim.code);
  update public.gift_code_claims
     set status = 'running', started_at = now(), attempt_count = attempt_count + 1
   where claim_id = v_claim.claim_id;
  insert into internal.gift_inflight (claim_id, request_id) values (v_claim.claim_id, v_request);
  update internal.gift_runner set last_sent_at = now() where singleton;
  return 1;
end;
$$;

revoke execute on function internal.gift_apply_answer(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function internal.set_gift_runner(boolean, text) from public, anon, authenticated;
revoke execute on function internal.gift_send_next() from public, anon, authenticated;

create function public.delete_gift_code(p_code_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
  v_claims int;
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;

  with gone as (
    delete from public.gift_code_claims
     where code_id = p_code_id and alliance_id = v_alliance
    returning 1
  )
  select count(*)::int into v_claims from gone;

  -- A request already in the air for a deleted claim is dropped by the
  -- cascade; its answer then finds nothing to settle.
  delete from public.gift_codes g
   where g.code_id = p_code_id
     and not exists (select 1 from public.gift_code_claims c where c.code_id = p_code_id);

  return v_claims;
end;
$$;

revoke all on function public.delete_gift_code(uuid) from public, anon, authenticated;
grant execute on function public.delete_gift_code(uuid) to authenticated, service_role;

comment on function public.delete_gift_code(uuid) is
  'Deletes a code from the list (0253): this alliance''s claims for it, and the code '
  'itself once no alliance has a claim on it. Returns the number of claims removed. '
  'Needs giftcodes.manage.';
