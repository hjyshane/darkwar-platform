-- 0252: gift codes sent by the database itself, so the queue drains with the
-- collector PC switched off.
--
-- 0251 left the sending to `dw-gift` on the collector PC. Switch the PC off and
-- the queue just sits there. Postgres can make the same outbound call itself
-- (pg_net, driven by pg_cron - the pattern 0130 already uses for Discord), so
-- the website's queue is worked whether or not any machine of ours is awake.
--
-- Each tick is a pair of passes, like 0130's deliver/reconcile:
--
--   gift_send_next()  pick ONE due claim and ask pg_net to GET the Gift Center's
--                     `code.php?uid=&code=` (with the `Usertoken` header the page
--                     itself sends). pg_net is asynchronous: this returns at once
--                     and the answer lands later in `net._http_response`.
--   gift_settle()     read the answers that have landed and settle each claim.
--
-- The rules are the ones `dw-gift` has (gift/worker.py, gift/official.py): one
-- request per `min_interval_seconds`, a run of non-answers pauses for 15
-- minutes, a block or challenge turns the runner OFF until a person turns it on,
-- a dead code retires the code and cancels what waits on it, and what the page
-- answered is kept verbatim in `result`.
--
-- OFF BY DEFAULT. Nothing is scheduled and nothing is sent until
-- `select internal.set_gift_runner(true)` is run or an officer flips the switch on the
-- Gift codes screen (public.set_gift_runner_enabled). The first real answers have
-- not been seen, so a person turns it on and watches. Turning it off also
-- unschedules the job, so a disabled feature costs nothing every few seconds.
--
-- `dw-gift` and this runner can coexist - both take a claim with a conditional
-- update, so one claim is never sent twice at the same moment - but they double
-- the rate. Run one of them.
--
-- The classification is a pure function and the settling is a function of
-- (claim, kind): both are tested without pg_net (supabase/tests/253). Only the
-- thin glue touches `net.*`.

-- ------------------------------------------------------------------ the state

create table internal.gift_runner (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  min_interval_seconds int not null default 5 check (min_interval_seconds >= 1),
  consecutive_non_answers int not null default 0,
  paused_until timestamptz,
  halted_reason text,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into internal.gift_runner (singleton) values (true);

-- Which pg_net request belongs to which claim. Not a column on the claims table:
-- it is plumbing, and the public table's shape (and its generated types) are
-- not changed for it.
create table internal.gift_inflight (
  claim_id uuid primary key references public.gift_code_claims (claim_id) on delete cascade,
  request_id bigint not null,
  sent_at timestamptz not null default now()
);

-- The `internal` schema is not exposed by the API, but a new table in prod
-- gets the default grants, so say it outright.
revoke all on internal.gift_runner, internal.gift_inflight from public, anon, authenticated;
alter table internal.gift_runner enable row level security;
alter table internal.gift_inflight enable row level security;

comment on table internal.gift_runner is
  'One row: whether the database sends gift-code claims itself (0252), the pace, and '
  'why it last stopped. Off by default; internal.set_gift_runner() turns it on.';

-- ------------------------------------------------------- what an answer means

-- Mirrors gift/official.py. `kind` is one of done / already / expired / invalid /
-- retry / stop.
create function internal.gift_classify(
  p_status int, p_content text, p_timed_out boolean, p_error text)
returns table (kind text, raw jsonb, error text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body jsonb;
  v_code text;
  v_num bigint;
begin
  if p_timed_out or p_status is null then
    return query select 'retry', jsonb_build_object('timed_out', coalesce(p_timed_out, false),
                                                   'error', p_error),
                        coalesce(p_error, 'no answer');
    return;
  end if;

  -- A block, not a verdict on this code: do not retry around it.
  if p_status in (403, 429, 503) then
    return query select 'stop', jsonb_build_object('http_status', p_status,
                                                   'body', left(coalesce(p_content, ''), 500)),
                        'the Gift Center answered HTTP ' || p_status;
    return;
  end if;

  begin
    v_body := p_content::jsonb;
  exception when others then
    return query select 'stop', jsonb_build_object('http_status', p_status,
                                                   'body', left(coalesce(p_content, ''), 500)),
                        'the Gift Center answered something that is not JSON';
    return;
  end;

  if jsonb_typeof(v_body) <> 'object' then
    return query select 'retry', jsonb_build_object('body', v_body), 'unexpected answer shape';
    return;
  end if;

  v_code := v_body ->> 'errorCode';
  if v_code is not null then
    return query select
      case v_code
        when 'ok' then 'done'
        when 'E004' then 'invalid'
        when 'E005' then 'expired'
        when 'E006' then 'already'
        -- E007 (a limit) is left as retry: whether it is per player or for the
        -- code is unknown, and it must not retire the code for everyone.
        else 'retry'
      end,
      v_body,
      case
        when v_code in ('ok', 'E006') then null
        when v_code in ('E004', 'E005', 'E007', 'E009', 'E001', 'E002', 'E003', 'E008')
          then v_code || ': ' || coalesce(v_body ->> 'message', '')
        else 'unrecognised errorCode ' || v_code
      end;
    return;
  end if;

  if (v_body ->> 'code') ~ '^[0-9]{1,9}$' then
    v_num := (v_body ->> 'code')::bigint;
    -- 10020 too frequent, 10022 account alert: ours to stop for. 10018 is about
    -- THIS player's id, so it fails the pair, not the runner.
    if v_num in (10020, 10022) then
      return query select 'stop', v_body, v_num || ': ' || coalesce(v_body ->> 'message', '');
      return;
    elsif v_num in (10018, 10006, 10007) then
      return query select 'retry', v_body, v_num || ': ' || coalesce(v_body ->> 'message', '');
      return;
    end if;
  end if;

  return query select 'retry', v_body, 'unrecognised answer';
end;
$$;

comment on function internal.gift_classify(int, text, boolean, text) is
  'Maps one Gift Center answer to done / already / expired / invalid / retry / stop '
  '(0252). Mirrors gift/official.py; the raw answer is kept so a wrong mapping is '
  'fixable from the stored result.';

-- -------------------------------------------------------------- settling a claim

-- What happens to a claim, and to the code and the runner, once its answer is
-- known. The twin of GiftWorker._settle. A claim that is not `running` is left
-- alone, so a repeated call settles nothing twice.
create function internal.gift_apply_answer(
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
    update internal.gift_runner set consecutive_non_answers = 0;

  elsif p_kind in ('expired', 'invalid') then
    update public.gift_code_claims
       set status = p_kind, finished_at = now(), result = p_raw
     where claim_id = p_claim_id;
    update public.gift_codes set status = p_kind, checked_at = now()
     where code_id = v_claim.code_id;
    update public.gift_code_claims
       set status = 'cancelled', finished_at = now()
     where code_id = v_claim.code_id and status = 'queued';
    update internal.gift_runner set consecutive_non_answers = 0;

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
    returning consecutive_non_answers into v_nonanswers;
    -- A run of non-answers: stop hammering a page that is telling us something.
    if v_nonanswers >= 5 then
      update internal.gift_runner
         set paused_until = now() + interval '15 minutes', consecutive_non_answers = 0;
    end if;
  end if;
end;
$$;

revoke execute on function internal.gift_apply_answer(uuid, text, jsonb, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------------- the switch

create function internal.set_gift_runner(p_enabled boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_enabled then
    update internal.gift_runner
       set enabled = true, halted_reason = null, paused_until = null,
           consecutive_non_answers = 0, updated_at = now();
    perform cron.schedule(
      'gift-runner', '5 seconds',
      $job$ select internal.gift_settle(), internal.gift_send_next(); $job$);
  else
    update internal.gift_runner
       set enabled = false, halted_reason = p_reason, updated_at = now();
    begin
      perform cron.unschedule('gift-runner');
    exception when others then
      null;  -- not scheduled: already off
    end;
  end if;
end;
$$;

revoke execute on function internal.set_gift_runner(boolean, text)
  from public, anon, authenticated;

comment on function internal.set_gift_runner(boolean, text) is
  'Turns the database-side gift sender on or off (0252) and schedules or unschedules '
  'its cron job. Run by a person: select internal.set_gift_runner(true).';

-- ---------------------------------------------------------------------- sending

create function internal.gift_http_get(p_uid bigint, p_code text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- plpgsql rather than sql so the body is not resolved when this is created:
  -- the pgTAP harness has no pg_net, and nothing calls this there.
  return net.http_get(
    url := 'https://giftcenter.darkwar-survival.com/code.php',
    params := jsonb_build_object('uid', p_uid::text, 'code', p_code),
    headers := jsonb_build_object('Usertoken', p_uid::text, 'User-Agent', 'Mozilla/5.0'),
    timeout_milliseconds := 20000);
end;
$$;

revoke execute on function internal.gift_http_get(bigint, text) from public, anon, authenticated;

create function internal.gift_send_next()
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
  update internal.gift_runner set last_sent_at = now();
  return 1;
end;
$$;

revoke execute on function internal.gift_send_next() from public, anon, authenticated;

-- --------------------------------------------------------------------- settling

create function internal.gift_settle()
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

revoke execute on function internal.gift_settle() from public, anon, authenticated;

-- ----------------------------------------------------- the officer's switch

-- The dashboard's way to read and flip the runner. Same capability as the rest
-- of the screen. Reading is a function of its own rather than a grant on the
-- internal table: the reason it stopped is the only thing the screen needs.
create function public.gift_runner_status()
returns table (
  enabled boolean,
  paused_until timestamptz,
  halted_reason text,
  last_sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  return query
    select r.enabled, r.paused_until, r.halted_reason, r.last_sent_at
    from internal.gift_runner r;
end;
$$;

create function public.set_gift_runner_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  perform internal.set_gift_runner(
    coalesce(p_enabled, false),
    case when coalesce(p_enabled, false) then null else 'turned off by an officer' end);
end;
$$;

revoke all on function public.gift_runner_status() from public, anon, authenticated;
revoke all on function public.set_gift_runner_enabled(boolean) from public, anon, authenticated;
grant execute on function public.gift_runner_status() to authenticated, service_role;
grant execute on function public.set_gift_runner_enabled(boolean) to authenticated, service_role;

comment on function public.set_gift_runner_enabled(boolean) is
  'Turns the database-side gift sender on or off (0252). Needs giftcodes.manage.';

-- cron's own run log would otherwise take a row every few seconds while the
-- runner is on.
select cron.schedule(
  'gift-runner-log-trim', '17 3 * * *',
  $job$ delete from cron.job_run_details
        where start_time < now() - interval '1 day' and command like '%gift_settle%' $job$);
