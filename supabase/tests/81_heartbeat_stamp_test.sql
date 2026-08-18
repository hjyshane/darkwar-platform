-- 0135: the badge measures one clock, and gives the beat room to arrive.
--
-- The bug was invisible in every environment that mattered: local Postgres and
-- the local collector share a clock, so a skewed heartbeat cannot be reproduced
-- by running the thing. It only showed up on the one machine nobody was
-- watching the clock on, as a dot that went grey and came back.
--
-- So the assertions are about the RULE rather than about any observed drift: a
-- timestamp the writer supplies must not survive, one nobody supplied must not
-- be invented, and the window the view allows must be the widened one.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

-- --------------------------------------------------------------- the stamp

-- An hour in the past, standing in for a collector whose clock is slow. An hour
-- rather than a minute so the assertion cannot pass by accident on a machine
-- where two clocks differ by milliseconds.
insert into public.collectors (collector_id, name, status, version, last_heartbeat_at)
values ('00000000-0000-4000-8000-00000000cf01', 'skewed', 'healthy', 'test',
        now() - interval '1 hour');

select ok(
  (select last_heartbeat_at from public.collectors
    where collector_id = '00000000-0000-4000-8000-00000000cf01')
  > now() - interval '1 minute',
  'a beat supplied on INSERT is stamped with server time, not the hour-old '
  'value the writer sent');

-- Registration with no beat at all. Stamping here would make a collector that
-- has never checked in look alive the moment somebody created the row.
insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cf02', 'never beat', 'offline', 'test');

select is(
  (select last_heartbeat_at from public.collectors
    where collector_id = '00000000-0000-4000-8000-00000000cf02'),
  NULL,
  'a registration carrying no beat stays null - never checked in is not the '
  'same as checked in just now');

-- The ordinary path: dw-sync PATCHes a beat with its own clock, every interval.
update public.collectors
   set last_heartbeat_at = now() - interval '1 hour', status = 'healthy'
 where collector_id = '00000000-0000-4000-8000-00000000cf02';

select ok(
  (select last_heartbeat_at from public.collectors
    where collector_id = '00000000-0000-4000-8000-00000000cf02')
  > now() - interval '1 minute',
  'and an UPDATE carrying a beat is stamped too - this is the path dw-sync '
  'actually takes');

-- The carve-out. An admin editing a collector must not revive it, or a rename
-- becomes a heartbeat and the badge lies in the other direction.
alter table public.collectors disable trigger stamp_heartbeat;
update public.collectors
   set last_heartbeat_at = now() - interval '2 hours'
 where collector_id = '00000000-0000-4000-8000-00000000cf01';
alter table public.collectors enable trigger stamp_heartbeat;

update public.collectors
   set name = 'renamed'
 where collector_id = '00000000-0000-4000-8000-00000000cf01';

select ok(
  (select last_heartbeat_at from public.collectors
    where collector_id = '00000000-0000-4000-8000-00000000cf01')
  < now() - interval '1 hour',
  'renaming a collector leaves its beat where it was - only a write that '
  'carries a beat counts as one');

-- ------------------------------------------------------------ the threshold
--
-- Asserted through the view, because three-rather-than-one is the whole change
-- and the number is written in exactly one place.
--
-- EVERY row, with no WHERE: `sync_status` is `max(last_heartbeat_at)` across
-- all collectors, so a seed row or a leftover from another test would decide
-- the answer instead of this one. And with the trigger held off, because it
-- exists precisely to stop a past timestamp being written — which is what this
-- half needs to do.
--
-- Read as a MEMBER: the view is definer with a role gate in its WHERE clause
-- (0121), and an unrecognised caller gets one row of nulls rather than a
-- refusal. Asserting `is_live` from a superuser session would be asserting
-- null, which is neither true nor false and would pass a broken threshold.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000cf03', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sync-member@test.invalid');
insert into public.app_users (user_id, role)
values ('00000000-0000-4000-8000-00000000cf03', 'member');

alter table public.collectors disable trigger stamp_heartbeat;
update public.collectors set last_heartbeat_at = now() - interval '2 minutes';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000cf03')::text, true);

select is(
  (select is_live from public.sync_status),
  true,
  'a beat two minutes old still reads as live - a slow outbox drain is not an '
  'outage, and dw-sync beats after the drain rather than on a fixed cadence');

reset role;
update public.collectors set last_heartbeat_at = now() - interval '4 minutes';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000cf03')::text, true);

select is(
  (select is_live from public.sync_status),
  false,
  'and four minutes reads as stopped - the window was widened, not removed');

reset role;
alter table public.collectors enable trigger stamp_heartbeat;

select * from finish();
rollback;
