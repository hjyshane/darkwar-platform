-- 0133: a post may name several channels, and only channels that exist.
--
-- 0127 had a FOREIGN KEY doing this. An array cannot carry one, so the work
-- moved to triggers — and a trigger is code where a constraint was a guarantee.
-- That trade is the reason this file exists: every job the foreign key used to
-- do is asserted here by hand, because nothing else is doing it any more.
--
-- The half most likely to be got wrong is the officer's. The check reads
-- `notification_channels`, which is admin-only INCLUDING select (0076), so a
-- validator that is not `security definer` sees an empty table, finds no match,
-- and rejects every name an officer picks — as "no such channel", from a
-- dropdown that just listed it. That is 0125's failure arriving through a new
-- door, and it would only show up when somebody who is not an admin writes a
-- guide.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ce001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chans-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chans-officer@test.invalid');

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ce001', 'admin'),
  ('00000000-0000-4000-8000-0000000ce002', 'officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.notification_channels (channel, webhook_url) values
  ('general', 'https://discord.test/webhooks/general'),
  ('war', 'https://discord.test/webhooks/war');

-- --------------------------------------------------------------- two rooms
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce001');

insert into public.announcements (title, body, channels)
values ('Maintenance', 'Down at 02:00 UTC.', array['war', 'general']);

select is(
  (select channels from public.announcements where title = 'Maintenance'),
  array['general', 'war'],
  'a notice keeps both rooms, sorted - a maintenance window belongs in two '
  'places and 0127 made the writer choose one');

-- Sorted rather than as typed, so two saves that picked the same rooms in a
-- different order are the same row. Asserted because the notifier reads this
-- array in order and an unstable order is an unstable message order.

-- --------------------------------------------------------- the empty answer
insert into public.announcements (title, body, channels)
values ('Standing', 'Read the rules.', array[]::text[]);

select is(
  (select channels from public.announcements where title = 'Standing'),
  NULL,
  'unticking everything means the settings default, not silence - an empty '
  'array would be a third state that reads identically in the form');

-- ------------------------------------------------------- a name that is not
select throws_ok(
  $$ insert into public.announcements (title, body, channels)
     values ('Nowhere', 'x', array['general', 'nosuchroom']) $$,
  '23503',
  NULL,
  'a channel with no webhook behind it is refused - the check the foreign key '
  'on 0127''s column used to do');

select throws_ok(
  $$ update public.announcements set channels = array['nosuchroom']
      where title = 'Maintenance' $$,
  '23503',
  NULL,
  'and refused on the way in on an UPDATE too, not only on INSERT');

-- ---------------------------------------------------------- the officer''s half
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce002');

insert into public.guides (title, body, category, channels)
values ('War plan', 'Rally at 20:00.', 'strategy', array['war']);

select is(
  (select channels from public.guides where title = 'War plan'),
  array['war'],
  'an officer can name a channel they cannot read the URL of - the validator '
  'is security definer, or every name in the dropdown is rejected as unknown');

select is(
  (select count(*) from public.notification_channels),
  0::bigint,
  'and still cannot read the table it was checked against - the definer '
  'validated a name, it did not hand over a credential');

reset role;

-- ------------------------------------------------- deleting a webhook
--
-- `on delete set null` is the other job the foreign key did. One name at a
-- time: a post that named two rooms keeps the room that still exists, which is
-- the behaviour the singular column could not have had.
delete from public.notification_channels where channel = 'war';

select is(
  (select channels from public.announcements where title = 'Maintenance'),
  array['general'],
  'deleting a webhook takes that room out and leaves the others alone');

select is(
  (select channels from public.guides where title = 'War plan'),
  NULL,
  'and a post that named only that room falls back to the settings default '
  'rather than being left pointing at a channel that is gone');

select * from finish();
rollback;
