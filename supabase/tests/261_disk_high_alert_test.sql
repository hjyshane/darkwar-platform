-- 0261: the disk alert speaks once a day while the size is over the line, and
-- not at all when it is switched off or under it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.notification_channels (channel, webhook_url)
values ('alarm', 'https://discord.test/webhooks/alarm');

delete from public.app_settings where key = 'discord_notifications';
insert into public.app_settings (key, value)
values ('discord_notifications', '{"disk_high": {"enabled": false, "channel": "alarm"}}'::jsonb);

select is(internal.detect_disk_high(1), 0,
  'switched off writes nothing, even far over the limit');

update public.app_settings
set value = '{"disk_high": {"enabled": true, "channel": "alarm"}}'::jsonb
where key = 'discord_notifications';

select is(internal.detect_disk_high(), 0,
  'under the real 7.5 GB line it stays quiet (the test database is small)');

select is(internal.detect_disk_high(1), 1, 'over the line it writes one row');
select is(internal.detect_disk_high(1), 0, 'and not a second the same UTC day');

select is(
  (select event || ' ' || channel from public.notification_outbox where event = 'disk_high'),
  'disk_high alarm', 'routed to the configured channel');

select ok('disk_high' = any (internal.database_owned_events()),
  'the database owns the event, so dw-notify must skip it');

select * from finish();
rollback;
