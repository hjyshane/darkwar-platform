-- 0327: a time that moves after an alarm already went out is announced once.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

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
   'queued only', 't327_point', now() + interval '1 day', null, false);

-- An alarm that reached Discord for every entry but e3 (never sent) and e6
-- (written, not delivered yet).
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, schedule_event_id, alarm_step, anchor_at, delivered_at)
select 't327-board', 'schedule_reminder', 'alarm:' || e || ':start:60:0', 't', 'b', e::uuid, 'start:60',
       now() + interval '1 day', now()
from unnest(array['00000000-0000-4000-8000-0000000327e1', '00000000-0000-4000-8000-0000000327e2',
                  '00000000-0000-4000-8000-0000000327e4', '00000000-0000-4000-8000-0000000327e5']) e;
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, schedule_event_id, alarm_step, anchor_at)
values ('t327-board', 'schedule_reminder', 'alarm:e6:start:60:0', 't', 'b',
        '00000000-0000-4000-8000-0000000327e6', 'start:60', now() + interval '1 day');

create function pg_temp.notices_after_move(p_entry text, p_by interval) returns bigint language plpgsql as $$
begin
  update public.schedule_events set starts_at = starts_at + p_by
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
select is(pg_temp.notices_after_move('00000000-0000-4000-8000-0000000327e1', interval '0'), 1::bigint,
  'the same move twice is one notice');
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

select * from finish();
rollback;
