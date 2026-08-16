-- 0124: who may write the calendar, and when a reminder says it is due.
--
-- Two separate things are pinned here and they fail differently.
--
-- The GATE is §20.2's requirement: a table that reaches Discord must not be
-- writable by everybody who can read it. An entry on this calendar becomes a
-- message to 94 people at the moment it names, so a member who can insert one
-- can announce anything at any time under the alliance's own webhook.
--
-- `fire_at` is the other. It is arithmetic, which is exactly the kind of thing
-- that looks obviously right and is off by a sign. Wrong, the reminder either
-- never fires or fires at a moment nobody chose — and both are invisible until
-- the day it matters, because nothing about a reminder is wrong until it is late.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000fc001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sched-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000fc002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sched-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000fc003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sched-viewer@test.invalid');

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000fc001', 'officer'),
  ('00000000-0000-4000-8000-0000000fc002', 'member'),
  ('00000000-0000-4000-8000-0000000fc003', 'viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.notification_channels (channel, webhook_url)
values ('alarm', 'https://discord.test/webhooks/alarm');

insert into public.schedule_categories (category, label, colour, channel)
values ('bear', 'Bear hunt', '#c2410c', 'alarm');

insert into public.schedule_events
  (schedule_event_id, title, category, starts_at)
values
  ('00000000-0000-4000-8000-0000000fe001', 'Bear 20:00', 'bear',
   '2026-08-20T20:00:00Z');

insert into public.schedule_reminders (schedule_event_id, minutes_before)
values ('00000000-0000-4000-8000-0000000fe001', 30);

-- ------------------------------------------------------------------ arithmetic
select is(
  (select fire_at from public.schedule_reminders_due
    where schedule_event_id = '00000000-0000-4000-8000-0000000fe001'),
  '2026-08-20T19:30:00Z'::timestamptz,
  'a 30-minute reminder is due half an hour BEFORE the entry, not after');

select is(
  (select channel from public.schedule_reminders_due
    where schedule_event_id = '00000000-0000-4000-8000-0000000fe001'),
  'alarm',
  'the channel comes from the category - the notifier needs no per-entry choice');

-- Moving the entry has to move the reminder. This is the whole reason
-- `minutes_before` is relative rather than an absolute timestamp: stored
-- absolutely, an edit leaves the reminder pointing at the old moment and the
-- mistake surfaces as a Discord message an hour early.
update public.schedule_events
set starts_at = '2026-08-20T22:00:00Z'
where schedule_event_id = '00000000-0000-4000-8000-0000000fe001';

select is(
  (select fire_at from public.schedule_reminders_due
    where schedule_event_id = '00000000-0000-4000-8000-0000000fe001'),
  '2026-08-20T21:30:00Z'::timestamptz,
  'moving the entry moved its reminder with it');

-- An entry with no category still belongs on the calendar; it just says nothing.
insert into public.schedule_events (schedule_event_id, title, starts_at)
values ('00000000-0000-4000-8000-0000000fe002', 'Quiet note', '2026-08-21T09:00:00Z');
insert into public.schedule_reminders (schedule_event_id, minutes_before)
values ('00000000-0000-4000-8000-0000000fe002', 10);

select is(
  (select channel from public.schedule_reminders_due
    where schedule_event_id = '00000000-0000-4000-8000-0000000fe002'),
  NULL,
  'an uncategorised entry has no channel rather than no row - it is still on '
  'the calendar, it simply announces nothing');

-- ----------------------------------------------------------------- the officer
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc001');

select lives_ok(
  $$ insert into public.schedule_events (title, starts_at)
     values ('Officer entry', '2026-08-22T10:00:00Z') $$,
  'an officer can add an entry - a calendar only one person can edit is wrong '
  'whenever that person is asleep, which is the case this work exists for');

-- ------------------------------------------------------------------ the member
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc002');

select isnt(
  (select count(*) from public.schedule_events),
  0::bigint,
  'a member reads the calendar');

select throws_ok(
  $$ insert into public.schedule_events (title, starts_at)
     values ('Member entry', '2026-08-22T10:00:00Z') $$,
  '42501',
  NULL,
  'a member cannot add one - an entry here becomes a Discord message to the '
  'whole alliance at the time it names');

-- ------------------------------------------------------------------ the viewer
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc003');

select is(
  (select count(*) from public.schedule_events),
  0::bigint,
  'a signed-in stranger sees no calendar at all');

reset role;

-- --------------------------------------------------------------------- the door
select throws_ok(
  $$ set local role anon; select count(*) from public.schedule_events $$,
  '42501',
  NULL,
  'anon cannot read the calendar - not an empty list, a refusal');

reset role;

select * from finish();
rollback;
