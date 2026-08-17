-- 0131: the three events that never needed the collector.
--
-- Same shape as 0130, and the assertions are the same two questions: is the
-- switch respected before anything is queried, and does the key say what an
-- already-announced thing is.
--
-- `schedule_reminder` gets the most attention because it is the only event in
-- the system whose fact EXPIRES. Everything else stays true while it waits.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.notification_channels (channel, webhook_url) values
  ('alarm', 'https://discord.test/webhooks/alarm'),
  ('bears', 'https://discord.test/webhooks/bears');

delete from public.app_settings where key = 'discord_notifications';
insert into public.app_settings (key, value) values ('discord_notifications', '{}'::jsonb);

-- --------------------------------------------------------------- the switches
select is(internal.detect_player_claims(), 0, 'claims: off writes nothing');
select is(internal.detect_new_signups(), 0, 'signups: off writes nothing');
select is(internal.detect_schedule_reminders(), 0, 'reminders: off writes nothing');

update public.app_settings set value = jsonb_build_object(
  'player_claim',      jsonb_build_object('enabled', true, 'channel', 'alarm'),
  'new_signup',        jsonb_build_object('enabled', true, 'channel', 'alarm'),
  'schedule_reminder', jsonb_build_object('enabled', true, 'channel', 'alarm'))
where key = 'discord_notifications';

-- ------------------------------------------------------------------- signups
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ea001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'waiting@test.invalid'),
  ('00000000-0000-4000-8000-0000000ea002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member@test.invalid');
insert into public.app_users (user_id, role)
values ('00000000-0000-4000-8000-0000000ea002', 'member');

select is(
  internal.detect_new_signups(), 1,
  'only the account with no app_users row is waiting - the row does not exist '
  'rather than saying viewer (0021, 0123)');

-- -------------------------------------------------------------------- claims
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000eb001', 580, 9900000000000001, 'Shane');
insert into public.player_claims (user_id, player_id, status)
values ('00000000-0000-4000-8000-0000000ea002', '00000000-0000-4000-8000-0000000eb001', 'pending');

select is(
  (select count(*) from public.notification_outbox
    where event = 'player_claim'
      and idempotency_key like 'player_claim:00000000-0000-4000-8000-0000000ea002:9900000000000001:%'),
  0::bigint,
  'nothing is queued until the detector runs');

select is(internal.detect_player_claims(), 1, 'a pending claim is announced once');

-- ----------------------------------------------------------------- reminders
insert into public.schedule_categories (category, label, channel)
values ('bear', 'Bear hunt', 'bears');
insert into public.schedule_events (schedule_event_id, title, category, starts_at)
values ('00000000-0000-4000-8000-0000000ec001', 'Bear hunt', 'bear', now() + interval '30 minutes');
insert into public.schedule_reminders (schedule_event_id, minutes_before)
values ('00000000-0000-4000-8000-0000000ec001', 30);

select is(
  (select channel from public.notification_outbox where event = 'schedule_reminder'
    order by notification_id desc limit 1),
  NULL,
  'nothing yet - the detector has not run');

select internal.detect_schedule_reminders();

-- The board's channel, not the settings one: one webhook per board is why
-- 0124 put the channel on the category at all.
select is(
  (select channel from public.notification_outbox where event = 'schedule_reminder'),
  'bears',
  'a reminder follows its board''s channel, with the settings channel only as '
  'the fallback');

select * from finish();
rollback;
