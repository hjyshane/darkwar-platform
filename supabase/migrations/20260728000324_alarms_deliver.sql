-- 0324: deliver alarms with a role ping, drop the ones that are too late, and
-- let the calendar read what happened to each step.
--
-- Three things 0130's deliverer could not do:
--
--   * PING. Discord only notifies a role when the message `content` carries
--     <@&id> AND `allowed_mentions` names that role. An embed alone never
--     pings. The allow-list is the safety: `parse: []` means nothing in the
--     free text (an officer's note saying @everyone) notifies anyone, and
--     `roles` opens exactly the board's one role.
--
--   * EXPIRE. An alarm for a battle that started 20 minutes ago is noise, and
--     after an outage the backlog would all land at once. A row carries
--     `expires_at` (0323: fire time + 15 minutes); one that has not left by
--     then is marked expired instead of sent. Alerts with a null `expires_at`
--     (sync_stalled, disk_high…) are never touched.
--
--   * NOT STARVE. 0130 took the oldest N rows and THEN looked up each one's
--     channel, skipping a disabled one — so ten old rows on a switched-off
--     channel hid every sendable row behind them, forever. The channel join
--     now happens inside the selection.
--
-- And two things 0130 got wrong:
--
--   * IT NEVER RAN. 0130 called `extensions.net.http_post` and read
--     `extensions.net._http_response`. Three dotted parts parse as
--     database.schema.object, so every statement that reached either failed
--     with "cross-database references are not implemented" — the
--     alerts-reconcile cron job, whose query runs every minute, has failed on
--     every tick in production. pg_net's functions and response
--     table live in schema `net`, which is how 0252's gift sender, the one
--     that works, calls them. reconcile_owned_alerts is restated below with
--     that one name changed.
--
--   * ONE BAD ROW SANK THE TICK. A raising http_post aborted the whole loop
--     and rolled back the bookkeeping of the rows already queued. Each row is
--     now its own subtransaction: a failure is recorded on that row and the
--     loop carries on.
--
-- Reminders 0199 queued before this carry no expires_at, so the sweep would
-- never drop them: the day a channel is switched on they would all go out at
-- once, days late. They are dated once, below, from when they were queued.
--
-- pg_net is not in the local pgTAP stub, so delivery is split: the payload,
-- the selection and the expiry are plain SQL and are tested; the function that
-- posts only wires them to http_post.

-- ------------------------------------------------------------------ payload

create function internal.alert_payload(p_title text, p_body text, p_ping_role_id text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ping_role_id is null then
      jsonb_build_object(
        'embeds', jsonb_build_array(
          jsonb_build_object('title', p_title, 'description', p_body)),
        'allowed_mentions', jsonb_build_object('parse', jsonb_build_array()))
    else
      jsonb_build_object(
        'content', left('<@&' || p_ping_role_id || '> ' || p_title, 2000),
        'embeds', jsonb_build_array(
          jsonb_build_object('title', p_title, 'description', p_body)),
        'allowed_mentions', jsonb_build_object(
          'parse', jsonb_build_array(),
          'roles', jsonb_build_array(p_ping_role_id)))
  end
$$;

comment on function internal.alert_payload(text, text, text) is
  'The JSON posted to a Discord webhook. With a role id, content carries the '
  'ping and allowed_mentions opens only that role; without one nothing in the '
  'text can notify anybody.';

revoke execute on function internal.alert_payload(text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------- expiry

create function internal.expire_stale_alerts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired int;
begin
  update public.notification_outbox
  set expired_at = now(),
      last_error = 'expired: not sent within 15 minutes of its time'
  where delivered_at is null
    and transport_request_id is null
    and expired_at is null
    and expires_at <= now();

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

comment on function internal.expire_stale_alerts() is
  'Marks undelivered rows past their expires_at as expired. A row already '
  'delivered or with a request in flight is left alone; a null expires_at '
  'never matches.';

revoke execute on function internal.expire_stale_alerts() from public, anon, authenticated;

-- 0199's undelivered reminders, dated from when they were queued (the time they
-- were due), so the first sweep drops the stale ones instead of sending them.
-- A function rather than a bare UPDATE so the test can run it on a row it
-- wrote; it runs once, here.
create function internal.date_legacy_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  update public.notification_outbox
     set expires_at = created_at + interval '15 minutes'
   where event = 'schedule_reminder'
     and delivered_at is null
     and transport_request_id is null
     and expired_at is null
     and expires_at is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function internal.date_legacy_reminders() from public, anon, authenticated;

select internal.date_legacy_reminders();

-- The pending index stops at expired rows as well as delivered ones; otherwise
-- every selection and sweep walks past each row ever dropped. Same name and
-- column as 0076's.
drop index public.notification_outbox_pending_idx;
create index notification_outbox_pending_idx
  on public.notification_outbox (created_at)
  where delivered_at is null and expired_at is null;

-- ---------------------------------------------------------------- selection

create function internal.next_alerts(p_limit int)
returns table (notification_id bigint, url text, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.notification_id,
         ch.webhook_url,
         internal.alert_payload(o.title, o.body, o.ping_role_id)
  from public.notification_outbox o
  join public.notification_channels ch on ch.channel = o.channel and ch.enabled
  where o.delivered_at is null
    and o.transport_request_id is null
    and o.attempts < 5
    and o.expired_at is null
    and (o.expires_at is null or o.expires_at > now())
    and o.event = any (internal.database_owned_events())
  order by o.created_at, o.notification_id
  limit p_limit
$$;

comment on function internal.next_alerts(int) is
  'The rows to post now, oldest first. The channel join is inside the '
  'selection so rows on a disabled or missing channel cannot occupy the limit '
  'and starve sendable ones.';

revoke execute on function internal.next_alerts(int) from public, anon, authenticated;

-- ------------------------------------------------------------- the deliverer
--
-- Same signature and cron job as 0130. A channel that is off or absent is a
-- configuration state, not a failed send, so it never burns the retry budget
-- (next_alerts simply does not offer it).
--
-- Each row is posted in its own block. If queueing one raises, that block's
-- work is rolled back (pg_net's queued request included), the row gets the
-- error and an attempt — so a row that always raises stops after five — and
-- the rows before and after it are unaffected.
create or replace function internal.deliver_owned_alerts(p_limit int default 10)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_sent int := 0;
begin
  perform internal.expire_stale_alerts();

  for v_row in select * from internal.next_alerts(p_limit)
  loop
    begin
      update public.notification_outbox o
      set transport_request_id = (
            select net.http_post(
              url := v_row.url,
              body := v_row.payload,
              headers := '{"Content-Type": "application/json"}'::jsonb)),
          attempts = o.attempts + 1
      where o.notification_id = v_row.notification_id;

      v_sent := v_sent + 1;
    exception when others then
      update public.notification_outbox o
      set attempts = o.attempts + 1,
          last_error = 'not queued: ' || sqlerrm
      where o.notification_id = v_row.notification_id;

      raise warning 'deliver_owned_alerts: notification % not queued: % (%)',
        v_row.notification_id, sqlerrm, sqlstate;
    end;
  end loop;
  return v_sent;
end;
$$;

revoke execute on function internal.deliver_owned_alerts(int) from public, anon, authenticated;

-- 0130's second pass, whole, with the one fix: `net._http_response`, not
-- `extensions.net._http_response`.
create or replace function internal.reconcile_owned_alerts()
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
    join net._http_response r on r.id = o.transport_request_id
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

-- -------------------------------------------------------- reading the state

create function public.alarm_deliveries(p_events uuid[])
returns table (
  schedule_event_id uuid,
  alarm_step text,
  anchor_at timestamptz,
  delivered_at timestamptz,
  expired_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.schedule_event_id, o.alarm_step, o.anchor_at, o.delivered_at, o.expired_at
  from public.notification_outbox o
  join public.schedule_events e on e.schedule_event_id = o.schedule_event_id
  where o.schedule_event_id = any (p_events)
    and o.alarm_step is not null
    -- 0194's alliance_scope, restated: the outbox is not readable by the API,
    -- so this definer function is the only door and has to apply the same
    -- rule the entry's own table would.
    and (select public.has_permission('schedule.view'))
    and coalesce(e.alliance_id, (select public.primary_own_alliance()))
        is not distinct from (select public.active_alliance())
$$;

comment on function public.alarm_deliveries(uuid[]) is
  'For the entries named: each alarm step that has been queued, with when it '
  'left (delivered_at) or was dropped as too late (expired_at). Only entries '
  'of the caller''s active alliance, and only with schedule.view.';

revoke execute on function public.alarm_deliveries(uuid[]) from public, anon;
grant execute on function public.alarm_deliveries(uuid[]) to authenticated;
