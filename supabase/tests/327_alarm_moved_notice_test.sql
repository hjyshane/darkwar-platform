-- 0327: a time that moves after an alarm already went out is announced once.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- ---------------------------------------------------------------- set-up

update public.alliances set is_own = false where is_own;
delete from public.app_settings where key = 'own_alliance';
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-0000000327a1', 580, 'ext-moved', 'MovedTest', true, 2);
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-0000000327a1"}');
select public.resolve_own_alliance();

insert into public.notification_channels (channel, webhook_url, alliance_id)
values ('t327-board', 'https://discord.invalid/board', '00000000-0000-4000-8000-0000000327a1');

insert into public.schedule_categories (alliance_id, category, label, channel, ping_role_id)
values ('00000000-0000-4000-8000-0000000327a1', 't327_point', 'Point', 't327-board', '123456789012345678');
insert into public.schedule_categories (alliance_id, category, label, kind, channel)
values ('00000000-0000-4000-8000-0000000327a1', 't327_window', 'Window', 'window', 't327-board');

insert into public.schedule_events
  (schedule_event_id, alliance_id, title, category, starts_at, ends_at, hidden)
values
  ('00000000-0000-4000-8000-0000000327e1', '00000000-0000-4000-8000-0000000327a1',
   'Zombie Siege', 't327_point', now() + interval '1 day', null, false),
  ('00000000-0000-4000-8000-0000000327e2', '00000000-0000-4000-8000-0000000327a1',
   'jitter', 't327_point', now() + interval '1 day', null, false),
  ('00000000-0000-4000-8000-0000000327e3', '00000000-0000-4000-8000-0000000327a1',
   'unsent', 't327_point', now() + interval '1 day', null, false),
  ('00000000-0000-4000-8000-0000000327e4', '00000000-0000-4000-8000-0000000327a1',
   'Black Gold', 't327_window', now() + interval '1 day', now() + interval '2 days', false),
  ('00000000-0000-4000-8000-0000000327e5', '00000000-0000-4000-8000-0000000327a1',
   'secret', 't327_point', now() + interval '1 day', null, true),
  ('00000000-0000-4000-8000-0000000327e6', '00000000-0000-4000-8000-0000000327a1',
   'queued only', 't327_point', now() + interval '1 day', null, false),
  ('00000000-0000-4000-8000-0000000327e7', '00000000-0000-4000-8000-0000000327a1',
   'adopted', 't327_point', now() + interval '1 day', null, false),
  -- 0249 writes an ends_at on every pick, point boards included.
  ('00000000-0000-4000-8000-0000000327e8', '00000000-0000-4000-8000-0000000327a1',
   'Siege with an end', 't327_point', now() + interval '1 day', now() + interval '2 days', false),
  ('00000000-0000-4000-8000-0000000327e9', '00000000-0000-4000-8000-0000000327a1',
   'Black Gold close', 't327_window', now() + interval '1 day', now() + interval '2 days', false),
  ('00000000-0000-4000-8000-000000327e10', '00000000-0000-4000-8000-0000000327a1',
   'no board', null, now() + interval '1 day', now() + interval '2 days', false),
  ('00000000-0000-4000-8000-000000327e11', '00000000-0000-4000-8000-0000000327a1',
   'notice only', 't327_point', now() + interval '1 day', null, false);

-- An entry with no board speaks through the alliance's routing.
delete from public.app_settings where key = 'discord_notifications';
insert into public.app_settings (key, value)
values ('discord_notifications', '{"schedule_reminder": {"enabled": true, "channel": "t327-board"}}');

-- An alarm that reached Discord for every entry but e3 (never sent), e6
-- (written, not delivered yet), e7 (sent under 0199's key, see below) and e11
-- (only a moved notice went out).
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, schedule_event_id, alarm_step, anchor_at, delivered_at)
select 't327-board', 'schedule_reminder', 'alarm:' || e || ':start:60:0', 't', 'b', e::uuid, 'start:60',
       now() + interval '1 day', now()
from unnest(array['00000000-0000-4000-8000-0000000327e1', '00000000-0000-4000-8000-0000000327e2',
                  '00000000-0000-4000-8000-0000000327e4', '00000000-0000-4000-8000-0000000327e5',
                  '00000000-0000-4000-8000-0000000327e8', '00000000-0000-4000-8000-0000000327e9',
                  '00000000-0000-4000-8000-000000327e10']) e;
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, schedule_event_id, alarm_step, anchor_at)
values ('t327-board', 'schedule_reminder', 'alarm:e6:start:60:0', 't', 'b',
        '00000000-0000-4000-8000-0000000327e6', 'start:60', now() + interval '1 day');
-- A send 0323 adopted: 0199's key, but tagged with its entry and step.
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, schedule_event_id, alarm_step, anchor_at, delivered_at)
values ('t327-board', 'schedule_reminder', 'schedule_reminder:t327-adopted', 't', 'b',
        '00000000-0000-4000-8000-0000000327e7', 'start:60', now() + interval '1 day', now());
-- A moved notice that went out is not an alarm: it has no step.
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, schedule_event_id, delivered_at)
values ('t327-board', 'schedule_reminder', 'alarm-moved:00000000-0000-4000-8000-000000327e11:0:none',
        't', 'b', '00000000-0000-4000-8000-000000327e11', now());

create function pg_temp.notices_after_move(p_entry text, p_by interval) returns bigint language plpgsql as $$
begin
  update public.schedule_events set starts_at = starts_at + p_by
   where schedule_event_id = p_entry::uuid;
  return (select count(*) from public.notification_outbox
           where idempotency_key like 'alarm-moved:' || p_entry || ':%');
end $$;

create function pg_temp.notices_after_end_move(p_entry text, p_by interval) returns bigint language plpgsql as $$
begin
  update public.schedule_events set ends_at = ends_at + p_by
   where schedule_event_id = p_entry::uuid;
  return (select count(*) from public.notification_outbox
           where idempotency_key like 'alarm-moved:' || p_entry || ':%');
end $$;

-- ------------------------------------------------------------------ tests

select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e1', interval '3 hours'), 1::bigint,
  'a move after an alarm went out is announced');
select ok((select body from public.notification_outbox where idempotency_key like 'alarm-moved:%e1:%') like
  '**Zombie Siege moved** — now <t:%:F> (<t:%:R>)', 'in the agreed words');
select is((select ping_role_id from public.notification_outbox where idempotency_key like 'alarm-moved:%e1:%'),
  '123456789012345678', 'the notice pings like the alarms');
select is((select channel from public.notification_outbox where idempotency_key like 'alarm-moved:%e1:%'),
  't327-board', 'and goes where the alarms go');
select ok((select expires_at from public.notification_outbox where idempotency_key like 'alarm-moved:%e1:%')
  > now() + interval '14 minutes', 'it lapses after 15 minutes');
select ok((select alarm_step is null and anchor_at is null from public.notification_outbox
            where idempotency_key like 'alarm-moved:%e1:%'), 'it is not an alarm step');
-- A -> B (above), B -> A, A -> B: the second A -> B is the same move again.
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e1', interval '-3 hours'), 2::bigint,
  'moving it back is announced too');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e1', interval '3 hours'), 2::bigint,
  'moving it forward again adds nothing');
select is((select count(*)::int
             from public.notification_outbox o
             join public.schedule_events e
               on o.idempotency_key = 'alarm-moved:' || e.schedule_event_id || ':'
                                      || extract(epoch from e.starts_at)::bigint || ':none'
            where e.schedule_event_id = '00000000-0000-4000-8000-0000000327e1'),
  1, 'the same move twice is one notice');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e2', interval '90 seconds'), 0::bigint,
  'jitter is not announced');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e3', interval '3 hours'), 0::bigint,
  'nothing sent yet: nothing to correct');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e6', interval '3 hours'), 0::bigint,
  'an alarm still queued has not reached anyone');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e5', interval '3 hours'), 0::bigint,
  'a hidden entry is silent');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e4', interval '3 hours'), 1::bigint,
  'a window board is announced too');
select ok((select body from public.notification_outbox where idempotency_key like 'alarm-moved:%e4:%')
  like '**Black Gold moved** — now <t:%:F> to <t:%:F>', 'and names both ends');

-- What counts as "an alarm already went out".
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e7', interval '3 hours'), 1::bigint,
  'a send 0323 adopted under 0199''s key counts as an alarm that went out');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-000000327e11', interval '3 hours'), 1::bigint,
  'a moved notice that went out does not (only the fixture''s own notice is there)');

-- Only a window's close is a time members were told; a point's ends_at is not.
select is(pg_temp.notices_after_end_move('00000000-0000-4000-8000-0000000327e8', interval '3 hours'), 0::bigint,
  'a point board''s end moving is not announced');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e8', interval '3 hours'), 1::bigint,
  'its start moving is');
select is(pg_temp.notices_after_end_move('00000000-0000-4000-8000-0000000327e9', interval '3 hours'), 1::bigint,
  'a window board''s close moving is announced');
select is(pg_temp.notices_after_end_move('00000000-0000-4000-8000-000000327e10', interval '3 hours'), 0::bigint,
  'an entry with no board is a point: its end moving is not announced');
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-000000327e10', interval '3 hours'), 1::bigint,
  'its start moving is');

select * from finish();
rollback;
