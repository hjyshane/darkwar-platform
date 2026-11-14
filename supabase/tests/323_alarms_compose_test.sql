-- 0323: what an alarm says, where it goes, and that each step goes out once.
--
-- The text is composed at send time from the entry's CURRENT times, so an
-- officer's message follows the game when it moves an event. The send is
-- remembered by entry + step + the time it was anchored to, not by reminder
-- row, so re-saving a reminder or a calendar re-read nudging a time by seconds
-- never posts the same alarm twice — while a real move does post again.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

-- ---------------------------------------------------------------- set-up

update public.alliances set is_own = false where is_own;
delete from public.app_settings where key = 'own_alliance';
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-0000000323a1', 580, 'ext-compose', 'ComposeTest', true, 2);
insert into public.alliances (alliance_id, server_id, external_id, current_name)
values ('00000000-0000-4000-8000-0000000323a2', 581, 'ext-compose-other', 'OtherTest');
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-0000000323a1"}');
select public.resolve_own_alliance();

insert into public.notification_channels (channel, webhook_url, alliance_id) values
  ('board-ch', 'https://discord.invalid/board', '00000000-0000-4000-8000-0000000323a1'),
  ('fallback-ch', 'https://discord.invalid/fallback', '00000000-0000-4000-8000-0000000323a1'),
  ('other-alliance-ch', 'https://discord.invalid/other', '00000000-0000-4000-8000-0000000323a2');

-- Routing off to begin with.
delete from public.app_settings where key = 'discord_notifications';
insert into public.app_settings (key, value) values ('discord_notifications', '{}'::jsonb);

-- Boards with no channel of their own: everything below goes to the fallback.
insert into public.schedule_categories (alliance_id, category, label, ping_role_id)
values ('00000000-0000-4000-8000-0000000323a1', 't323_point', 'Point', '123456789012345678');
insert into public.schedule_categories (alliance_id, category, label, kind, start_reminders)
values ('00000000-0000-4000-8000-0000000323a1', 't323_window', 'Window', 'window', '{}');
insert into public.schedule_categories (alliance_id, category, label)
values ('00000000-0000-4000-8000-0000000323a1', 't323_doomed', 'Doomed');

-- Every entry gets its board's default steps (0322). Times are relative to the
-- transaction's now(), so "start:60" of an entry an hour away is due now.
insert into public.schedule_events
  (schedule_event_id, alliance_id, title, category, starts_at, ends_at, alarm_message, hidden)
values
  ('00000000-0000-4000-8000-0000000323e1', '00000000-0000-4000-8000-0000000323a1',
   'due now', 't323_point', now() + interval '60 minutes', null, 'Bring shields', false),
  ('00000000-0000-4000-8000-0000000323e2', '00000000-0000-4000-8000-0000000323a1',
   'late 20m', 't323_point', now() + interval '40 minutes', null, null, false),
  ('00000000-0000-4000-8000-0000000323e3', '00000000-0000-4000-8000-0000000323a1',
   'disabled', 't323_point', now() + interval '60 minutes', null, null, false),
  ('00000000-0000-4000-8000-0000000323e4', '00000000-0000-4000-8000-0000000323a1',
   'hidden', 't323_point', now() + interval '60 minutes', null, null, true),
  ('00000000-0000-4000-8000-0000000323e5', '00000000-0000-4000-8000-0000000323a1',
   'window no end', 't323_window', now() - interval '1 minute', null, null, false),
  ('00000000-0000-4000-8000-0000000323e6', '00000000-0000-4000-8000-0000000323a1',
   'orphan', 't323_doomed', now() + interval '60 minutes', null, null, false),
  ('00000000-0000-4000-8000-0000000323e7', '00000000-0000-4000-8000-0000000323a1',
   'once now', 't323_point', now() + interval '2 days', null, null, false),
  ('00000000-0000-4000-8000-0000000323e8', '00000000-0000-4000-8000-0000000323a1',
   'legacy', 't323_point', now() + interval '60 minutes', null, null, false);

update public.schedule_reminders set enabled = false
 where schedule_event_id = '00000000-0000-4000-8000-0000000323e3'
   and anchor = 'start' and minutes_before = 60;

-- Deleting the board clears the entry's category (0203); its rows stay.
delete from public.schedule_categories
 where alliance_id = '00000000-0000-4000-8000-0000000323a1' and category = 't323_doomed';

insert into public.schedule_reminders (schedule_event_id, anchor, send_at)
values ('00000000-0000-4000-8000-0000000323e7', 'start', now());

-- What the old detector (0199) wrote for a step it already sent: no entry, no
-- step, the reminder's id and the start time in the key. The deploy step that
-- adopts such rows ran when 0323 was applied; it is run again here on this one.
insert into public.notification_outbox (channel, event, idempotency_key, title, body)
select 'fallback-ch', 'schedule_reminder',
       'schedule_reminder:' || r.reminder_id || ':' ||
         to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS+00:00'),
       e.title, 'Starting in 60 minutes'
  from public.schedule_reminders r
  join public.schedule_events e using (schedule_event_id)
 where r.schedule_event_id = '00000000-0000-4000-8000-0000000323e8'
   and r.anchor = 'start' and r.minutes_before = 60;
select internal.adopt_legacy_reminder_sends();

-- Detect, then count one entry's sends of one step ('once' matches 'once:…').
create function pg_temp.sent(p_entry uuid, p_step text) returns int
language plpgsql as $$
begin
  perform internal.detect_schedule_reminders();
  return (select count(*)::int from public.notification_outbox
           where schedule_event_id = p_entry
             and (alarm_step = p_step or alarm_step like p_step || ':%'));
end;
$$;

-- What the Alarms tab must not do, done anyway: delete the entry's reminder
-- rows and insert them again, so every one has a new id.
create function pg_temp.resave_then_count(p_entry uuid) returns int
language plpgsql as $$
declare
  v_rows public.schedule_reminders[];
begin
  select array_agg(r) into v_rows from public.schedule_reminders r
   where r.schedule_event_id = p_entry;
  delete from public.schedule_reminders where schedule_event_id = p_entry;
  insert into public.schedule_reminders (schedule_event_id, anchor, minutes_before, send_at, enabled)
  select p_entry, x.anchor, x.minutes_before, x.send_at, x.enabled from unnest(v_rows) x;
  perform internal.detect_schedule_reminders();
  return (select count(*)::int from public.notification_outbox where schedule_event_id = p_entry);
end;
$$;

-- now() is fixed inside this transaction, so the ENTRY cannot be moved and
-- still be due. The recorded send is moved instead — as if the step went out
-- when the event was `p_shift` earlier and the game has since moved it to now.
create function pg_temp.nudge_then_count(p_entry uuid, p_shift interval) returns int
language plpgsql as $$
begin
  update public.notification_outbox
     set anchor_at = anchor_at - p_shift,
         idempotency_key = regexp_replace(idempotency_key, ':[0-9]+$',
                             ':' || extract(epoch from anchor_at - p_shift)::bigint)
   where schedule_event_id = p_entry;
  perform internal.detect_schedule_reminders();
  return (select count(*)::int from public.notification_outbox where schedule_event_id = p_entry);
end;
$$;

-- ---------------------------------------------------------------- the text

select is(internal.alarm_render('Rally {start} ({in}) till {end}', '2026-11-20 12:00Z', '2026-11-20 13:00Z'),
  'Rally <t:1795176000:F> (<t:1795176000:R>) till <t:1795179600:F>',
  'placeholders render from the times given');
select is(internal.alarm_line('window', 'start', 0, null, '2026-11-20 12:00Z', '2026-11-20 13:00Z'),
  'Open now — closes <t:1795179600:F> (<t:1795179600:R>)', 'open line');
select is(internal.alarm_line('window', 'end', 60, null, '2026-11-20 12:00Z', '2026-11-20 13:00Z'),
  'Closes <t:1795179600:F> (<t:1795179600:R>)', 'close line');
select is(internal.alarm_line(null, 'start', 5, null, '2026-11-20 12:00Z', null),
  'Starts <t:1795176000:F> (<t:1795176000:R>)', 'no board reads as point');
select is(
  internal.alarm_line('window', 'start', null, '2026-11-20 11:00Z', '2026-11-20 12:00Z', '2026-11-20 13:00Z')
    || ' | ' ||
  internal.alarm_line('window', 'start', null, '2026-11-20 12:30Z', '2026-11-20 12:00Z', '2026-11-20 13:00Z'),
  'Opens <t:1795176000:F> (<t:1795176000:R>) | Closes <t:1795179600:F> (<t:1795179600:R>)',
  'a one-off on a window says when it opens before the start, when it closes after');
select ok(right(internal.alarm_description(repeat('x', 5000), 'Starts <t:1:F> (<t:1:R>)'), 24)
  = 'Starts <t:1:F> (<t:1:R>)' and length(internal.alarm_description(repeat('x', 5000), 'Starts <t:1:F> (<t:1:R>)')) <= 4096,
  'trimming cuts the message, never the time line');

-- ------------------------------------------------------------- the route

select is(internal.alarm_route('00000000-0000-4000-8000-0000000323a1', 'board-ch'), 'board-ch',
  'a board channel works with routing off');

update public.app_settings
   set value = '{"schedule_reminder": {"enabled": true, "channel": "fallback-ch"}}'
 where key = 'discord_notifications';

select is(internal.alarm_route('00000000-0000-4000-8000-0000000323a1', null), 'fallback-ch',
  'no board channel: the alliance fallback');
select is(internal.alarm_route('00000000-0000-4000-8000-0000000323a1', 'other-alliance-ch'), 'fallback-ch',
  'never another alliance''s channel');

-- ------------------------------------------------------------- detection

select is(pg_temp.sent('00000000-0000-4000-8000-0000000323e1', 'start:60'), 1,
  'a step inside the grace is sent');
select is(
  (select o.idempotency_key || ' ' || o.alarm_step || ' ' || o.channel || ' ' || o.ping_role_id
          || ' ' || (o.expires_at = e.starts_at - interval '45 minutes')::text
          || ' ' || (o.anchor_at = e.starts_at)::text
     from public.notification_outbox o
     join public.schedule_events e using (schedule_event_id)
    where o.schedule_event_id = '00000000-0000-4000-8000-0000000323e1'),
  (select 'alarm:00000000-0000-4000-8000-0000000323e1:start:60:'
          || extract(epoch from starts_at)::bigint
          || ' start:60 fallback-ch 123456789012345678 true true'
     from public.schedule_events
    where schedule_event_id = '00000000-0000-4000-8000-0000000323e1'),
  'the row carries its key, step, channel, ping, expiry and anchor');
select is(pg_temp.sent('00000000-0000-4000-8000-0000000323e2', 'start:60'), 0,
  'a step 20 minutes late is not');
select is(pg_temp.sent('00000000-0000-4000-8000-0000000323e3', 'start:60'), 0,
  'a turned-off step is not');
select is(pg_temp.sent('00000000-0000-4000-8000-0000000323e4', 'start:60'), 0,
  'a hidden entry sends nothing');
select is(pg_temp.sent('00000000-0000-4000-8000-0000000323e5', 'start:0'), 1,
  'a window with no end still opens');                                                  -- Review Focus 2
select is(pg_temp.sent('00000000-0000-4000-8000-0000000323e5', 'end:5'), 0,
  'and never closes');
select is((select body from public.notification_outbox
            where schedule_event_id = '00000000-0000-4000-8000-0000000323e5'),
  'Open now', 'an open alarm with no known close says only that it is open');
select is(pg_temp.sent('00000000-0000-4000-8000-0000000323e6', 'start:60'), 1,
  'an entry whose board was deleted still sends');                                      -- Review Focus 4
select is(
  (select string_agg(split_part(idempotency_key, ':', 1), ',')
     from public.notification_outbox
    where schedule_event_id = '00000000-0000-4000-8000-0000000323e8'),
  'schedule_reminder',
  'a step the old detector already sent is adopted, not sent again');

-- ---------------------------------------------------- re-save, jitter, move

select is(pg_temp.resave_then_count('00000000-0000-4000-8000-0000000323e1'), 1,
  'delete + re-insert of a sent step sends nothing new');
select is(pg_temp.nudge_then_count('00000000-0000-4000-8000-0000000323e1', interval '1 minute'), 1,
  'a 1-minute nudge does not re-send');                                                 -- Review Focus 1
select is(pg_temp.nudge_then_count('00000000-0000-4000-8000-0000000323e1', interval '3 hours'), 2,
  'a 3-hour move sends again at the new time');
select is(pg_temp.sent('00000000-0000-4000-8000-0000000323e7', 'once'), 1,
  'send now goes out once');
-- A one-off's fire_at is its send_at, which does not move with the entry: it
-- stays inside the grace after a move, so only the step can say it was sent.
select is(pg_temp.nudge_then_count('00000000-0000-4000-8000-0000000323e7', interval '3 hours'), 1,
  'and not again when its entry moves');
select ok((select body from public.notification_outbox
            where schedule_event_id = '00000000-0000-4000-8000-0000000323e1' limit 1)
  like 'Bring shields%Starts <t:%', 'officer message first, generated line last');

select * from finish();
rollback;
