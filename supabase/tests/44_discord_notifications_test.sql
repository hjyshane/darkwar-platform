-- 0076: who can read a webhook URL, and what stops a second post.
--
-- The URL is a credential — anybody holding it can post to the alliance's channel
-- as anyone. So the negative tests here are not a formality: the whole reason the
-- table exists separately from `app_settings` is that app_settings is readable by
-- every member, and if this one turns out to be too, the split bought nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad076', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'discord-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000be076', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'discord-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce076', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'discord-officer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad076', 'admin'),
  ('00000000-0000-4000-8000-0000000be076', 'member'),
  ('00000000-0000-4000-8000-0000000ce076', 'officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Seeded as the owner, the way the deliverer's service key would.
insert into public.notification_channels (channel, webhook_url) values
  ('reports', 'https://discord.com/api/webhooks/000/SECRET-TOKEN-DO-NOT-LEAK');

insert into public.notification_outbox (channel, event, idempotency_key, title, body)
values ('reports', 'rank_period', 'rank_period:2026-08-03:4', 'Rank period', 'body');

set local role authenticated;

-- ------------------------------------------------------------------ the member
-- FIRST. A member is the case this table's existence is justified by.
select pg_temp.act_as('00000000-0000-4000-8000-0000000be076');
select is(
  (select count(*) from public.notification_channels),
  0::bigint,
  'a member cannot read a webhook URL — the whole reason this is not in app_settings');
select is(
  (select count(*) from public.notification_outbox),
  0::bigint,
  'nor what has been posted');

-- An officer either. Officers can do a great deal in this schema (0066), and
-- "can post as the alliance" is not on the list.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce076');
select is(
  (select count(*) from public.notification_channels),
  0::bigint,
  'an officer cannot read one either');

-- And nobody but an admin may write one. A member who could INSERT a channel
-- could point an enabled event at a webhook of their own.
select throws_ok(
  $$ insert into public.notification_channels (channel, webhook_url)
     values ('mine', 'https://discord.com/api/webhooks/1/x') $$,
  '42501',
  NULL,
  'and cannot add one of their own');

select throws_ok(
  $$ insert into public.notification_outbox (channel, event, idempotency_key, title, body)
     values ('reports', 'test', 'test:member', 'Hello', 'from a member') $$,
  '42501',
  NULL,
  'and cannot queue a message, not even the harmless one');

-- ------------------------------------------------------------------- the admin
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad076');

-- The positive half. A gate that refuses everybody passes every negative test
-- ever written (0055), and this one has a settings screen depending on it.
select is(
  (select webhook_url from public.notification_channels where channel = 'reports'),
  'https://discord.com/api/webhooks/000/SECRET-TOKEN-DO-NOT-LEAK',
  'an admin reads the URL, because the settings screen has to show it');
select is(
  (select count(*) from public.notification_outbox),
  1::bigint,
  'and reads what has been sent');

select lives_ok(
  $$ update public.notification_channels set enabled = false where channel = 'reports' $$,
  'an admin can turn a channel off without deleting the URL');

-- The one narrow write from a browser: the settings screen's wiring check.
select lives_ok(
  $$ insert into public.notification_outbox (channel, event, idempotency_key, title, body)
     values ('reports', 'test', 'test:reports', 'Dark War dashboard', 'wired up') $$,
  'an admin can queue the "Send test" message');

-- And nothing else. Without the event check an admin could put any title and body
-- in the alliance channel over the collector's name, recorded as an ordinary
-- announcement. Every real announcement has to come from something observed.
select throws_ok(
  $$ insert into public.notification_outbox (channel, event, idempotency_key, title, body)
     values ('reports', 'rank_period', 'rank_period:forged', 'Promotions', 'made up') $$,
  '42501',
  NULL,
  'but cannot forge an announcement of any other kind');

-- ------------------------------------------------------------- the routing key
-- Deliberately world-readable, and deliberately carries no URL. A member seeing
-- that departures are announced is fine; a member being able to announce one is
-- not.
select pg_temp.act_as('00000000-0000-4000-8000-0000000be076');
select isnt(
  (select value from public.app_settings where key = 'discord_notifications'),
  null,
  'a member can read the routing, which names channels and not URLs');
select is(
  (select value::text like '%webhook%' from public.app_settings
    where key = 'discord_notifications'),
  false,
  'and there is no URL in it — that is what makes it safe to be readable');

reset role;

-- ------------------------------------------------------------------ the dedupe
-- A duplicate post is visible to 94 people. The unique key is what makes the
-- deliverer's "has this been announced" question a database question rather than
-- something it has to remember across restarts.
select throws_ok(
  $$ insert into public.notification_outbox (channel, event, idempotency_key, title, body)
     values ('reports', 'rank_period', 'rank_period:2026-08-03:4', 'again', 'again') $$,
  '23505',
  NULL,
  'the same message cannot be enqueued twice');

select * from finish();
rollback;
