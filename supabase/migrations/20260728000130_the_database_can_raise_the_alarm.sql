-- 0130: the alarm about the collector stops living on the collector.
--
-- `sync_stalled` exists to say "nothing has checked in for ten minutes". It is
-- composed and delivered by `dw-notify`, which runs on the collector's own
-- machine. Whatever kills the collector kills the notifier with it, so the one
-- event that matters most when the machine is down is the one event guaranteed
-- not to fire. docs/runbooks/alerting.md has said so since the day it was
-- written; this is the first half of fixing it.
--
-- FIRST HALF, deliberately. `player_claim`, `new_signup` and
-- `schedule_reminder` have the same problem in a milder form and can move the
-- same way afterwards. The content events — rank periods, departures, guides,
-- notices — stay in Python: they describe things that only exist because the
-- collector is running, so a dead collector has nothing to announce, and their
-- rules (the six-hour settle, the backlog windows, `live_at`) are subtle enough
-- that a second implementation is a second thing to be wrong.
--
-- ONE DELIVERER PER EVENT. Two processes draining the same outbox row is two
-- Discord messages. The split is by `event`: this file owns `sync_stalled` and
-- nothing else, and the same commit stops `dw-notify` from enqueueing or
-- delivering it. `notification_outbox.idempotency_key` still protects against a
-- duplicate compose either way, but nothing protects against a duplicate POST
-- except deciding who sends.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Which events this file is responsible for. A list rather than a flag on the
-- row: the ownership is a property of the code, not of the message, and a
-- column would let the two sides disagree about who was sending.
create function internal.database_owned_events()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['sync_stalled']::text[] $$;

comment on function internal.database_owned_events() is
  'Events composed and delivered inside Postgres rather than by dw-notify. '
  'dw-notify skips exactly this list; see notify/worker.py.';

-- --------------------------------------------------------------- the detector
--
-- The same rule dw-notify used, and the same KEY, so the two can never disagree
-- about whether an outage has already been announced: the episode is the last
-- heartbeat, which does not move while nothing is beating, so every pass
-- composes one key per outage rather than one per check.
create function internal.detect_sync_stalled()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_routing jsonb;
  v_channel text;
  v_written int := 0;
begin
  select value into v_routing from public.app_settings where key = 'discord_notifications';
  v_channel := v_routing -> 'sync_stalled' ->> 'channel';
  if v_channel is null or coalesce((v_routing -> 'sync_stalled' ->> 'enabled')::boolean, false) is not true
  then
    -- Switched off is silent, and silent means no query beyond this one. This
    -- runs every minute forever.
    return 0;
  end if;

  with silent as (
    select c.collector_id, c.name, c.last_heartbeat_at
    from public.collectors c
    where c.last_heartbeat_at is not null
      -- Ten minutes, matching SYNC_SILENCE in the worker. The dashboard calls
      -- the board stale after one; a badge may flicker and a Discord message
      -- may not.
      and c.last_heartbeat_at < now() - interval '10 minutes'
  )
  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  select
    v_channel,
    'sync_stalled',
    'sync_stalled:' || s.collector_id || ':' ||
      to_char(s.last_heartbeat_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS+00:00'),
    'Collection stopped',
    '**' || coalesce(s.name, left(s.collector_id::text, 8)) || '** has stopped checking in.'
      || chr(10) || chr(10)
      || 'Last seen: ' || to_char(s.last_heartbeat_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
      || 'Z' || chr(10)
      || 'Nothing is being collected or synced until it comes back.'
  from silent s
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

comment on function internal.detect_sync_stalled() is
  'Writes one outbox row per collector outage, keyed on the heartbeat that '
  'stopped so an outage announces once however long it lasts. Mirrors '
  'SYNC_SILENCE and the key format in notify/worker.py.';

revoke execute on function internal.detect_sync_stalled() from public, anon, authenticated;

-- -------------------------------------------------------------- the deliverer
--
-- `pg_net` is ASYNCHRONOUS. `http_post` queues a request and returns an id;
-- the response lands later in `net._http_response`. So delivery is two passes,
-- and the row carries the request id between them. Marking a row delivered at
-- the moment it was queued would report success for a webhook that answered
-- 404 — the failure mode 0076 built `attempts` and `last_error` to make
-- visible.
alter table public.notification_outbox
  add column if not exists transport_request_id bigint;

comment on column public.notification_outbox.transport_request_id is
  'pg_net request id for a row this database is delivering itself, held '
  'between queueing the POST and reading its response. Null for rows dw-notify '
  'delivers, which are synchronous.';

create function internal.deliver_owned_alerts(p_limit int default 10)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_url text;
  v_sent int := 0;
begin
  for v_row in
    select o.notification_id, o.channel, o.title, o.body
    from public.notification_outbox o
    where o.delivered_at is null
      and o.transport_request_id is null
      and o.attempts < 5
      and o.event = any (internal.database_owned_events())
    order by o.created_at
    limit p_limit
  loop
    select ch.webhook_url into v_url
    from public.notification_channels ch
    where ch.channel = v_row.channel and ch.enabled;

    if v_url is null then
      -- A channel that is off or absent is a configuration state, not a failed
      -- send: it must not burn the retry budget while an admin is still
      -- setting things up. Same rule as the worker.
      continue;
    end if;

    update public.notification_outbox
    set transport_request_id = (
          select extensions.net.http_post(
            url := v_url,
            body := jsonb_build_object(
              'embeds', jsonb_build_array(
                jsonb_build_object('title', title, 'description', body))),
            headers := '{"Content-Type": "application/json"}'::jsonb)),
        attempts = attempts + 1
    where notification_id = v_row.notification_id;

    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;

revoke execute on function internal.deliver_owned_alerts(int) from public, anon, authenticated;

-- The second pass: what did Discord say.
create function internal.reconcile_owned_alerts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done int := 0;
begin
  with answered as (
    select o.notification_id, r.status_code, r.error_msg
    from public.notification_outbox o
    join extensions.net._http_response r on r.id = o.transport_request_id
    where o.delivered_at is null
      and o.transport_request_id is not null
  ),
  settled as (
    update public.notification_outbox o
    set delivered_at = case when a.status_code between 200 and 299 then now() end,
        last_error = case
          when a.status_code between 200 and 299 then null
          else coalesce(a.error_msg, 'HTTP ' || coalesce(a.status_code::text, '?'))
        end,
        -- Cleared so a failure is picked up again by the next delivery pass;
        -- `attempts` is what stops it going round forever.
        transport_request_id = null
    from answered a
    where o.notification_id = a.notification_id
    returning o.notification_id
  )
  select count(*) into v_done from settled;
  return v_done;
end;
$$;

revoke execute on function internal.reconcile_owned_alerts() from public, anon, authenticated;

-- ------------------------------------------------------------------ the clock
--
-- One minute. The event it serves is "ten minutes of silence", so a minute of
-- granularity is noise against the threshold — and each tick is two index
-- lookups and, almost always, nothing to do. `detect` returns without touching
-- anything when the event is switched off.
select cron.schedule(
  'alerts-detect',
  '* * * * *',
  $$ select internal.detect_sync_stalled(), internal.deliver_owned_alerts(); $$);

select cron.schedule(
  'alerts-reconcile',
  '* * * * *',
  $$ select internal.reconcile_owned_alerts(); $$);
