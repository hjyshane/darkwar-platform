-- 0130: the alarm about the collector, raised by something that is not the collector.
--
-- `sync_stalled` says "nothing has checked in for ten minutes". Composed and
-- delivered by dw-notify, which runs ON the collector, it is the one event
-- guaranteed not to fire when it is needed. This is the same rule implemented
-- where the collector's power supply cannot reach it.
--
-- The assertions are mostly about the KEY, because that is what stops a
-- fortnight away from becoming four thousand identical messages, and about the
-- switch, because this runs every minute forever.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name, status, version, last_heartbeat_at)
values
  ('00000000-0000-4000-8000-0000000da001', 'silent-one', 'offline', 'test',
   '2026-08-16T04:05:00Z'),
  ('00000000-0000-4000-8000-0000000da002', 'busy-one', 'healthy', 'test', now());

insert into public.notification_channels (channel, webhook_url)
values ('alarm', 'https://discord.test/webhooks/alarm');

-- ------------------------------------------------------------------- the switch
delete from public.app_settings where key = 'discord_notifications';
insert into public.app_settings (key, value)
values ('discord_notifications', '{"sync_stalled": {"enabled": false, "channel": "alarm"}}'::jsonb);

select is(
  internal.detect_sync_stalled(), 0,
  'switched off writes nothing - this runs every minute forever, so an event '
  'that queries before checking its switch is a permanent load for a disabled '
  'feature');

update public.app_settings
set value = '{"sync_stalled": {"enabled": true, "channel": "alarm"}}'::jsonb
where key = 'discord_notifications';

-- --------------------------------------------------------------------- the alarm
select is(
  internal.detect_sync_stalled(), 1,
  'a collector silent for ten minutes is announced, and the one beating now is not');

select is(
  (select idempotency_key from public.notification_outbox where event = 'sync_stalled'),
  'sync_stalled:00000000-0000-4000-8000-0000000da001:2026-08-16T04:05:00+00:00',
  'keyed on the heartbeat that stopped, in the shape notify/worker.py writes - '
  'the two sides must agree or an outage is announced twice');

select is(
  internal.detect_sync_stalled(), 0,
  'and a second pass adds nothing: the episode key does not move while the '
  'silence lasts, so one outage is one message however long nobody is home');

-- ------------------------------------------------------------------ the delivery
-- A channel that is switched off is a configuration state rather than a failed
-- send, and must not burn the retry budget while an admin is still setting up.
update public.notification_channels set enabled = false where channel = 'alarm';

select is(
  (select attempts from public.notification_outbox where event = 'sync_stalled'),
  0,
  'a disabled channel does not count as an attempt');

-- ------------------------------------------------------------------- ownership
select is(
  internal.database_owned_events(),
  array['sync_stalled']::text[],
  'and this file owns exactly one event - two deliverers on one row is two '
  'Discord messages, and only the split by event stops that');

select * from finish();
rollback;
