-- 0208: members read the event calendar and its names; officers and admins
-- name events; members cannot; viewers and anon read nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ec001', 'event-calendar-test');

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000ec101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ec-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ec102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ec-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000ec103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ec-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000ec101', 'member', 'ec member'),
  ('00000000-0000-4000-8000-0000000ec102', 'officer', 'ec officer'),
  ('00000000-0000-4000-8000-0000000ec103', 'viewer', 'ec viewer')
on conflict (user_id) do update set role = excluded.role;

-- An older calendar and a newer one; the view must show only the newer.
insert into public.event_schedule_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, events)
values
  (gen_random_uuid(), 'init', '1.0.0', 'ec-test:old', '2026-10-01 00:00+00',
   '00000000-0000-4000-8000-0000000ec001', 580, 580,
   '[{"id": "99999", "startTime": 1790000000000, "endTime": 1790100000000}]'),
  (gen_random_uuid(), 'init', '1.0.0', 'ec-test:new', '2026-10-02 21:40+00',
   '00000000-0000-4000-8000-0000000ec001', 580, 580,
   '[{"id": "41101", "startTime": 1787364000000, "endTime": 1792461600000,
      "needMainCityLevel": 10, "icecave_opentime": "1;1;720|2;3;720|3;5;720"},
     {"id": "30000", "startTime": 0, "endTime": 0, "needMainCityLevel": 6},
     {"id": "80002", "startTime": 1791165600000, "endTime": 1791770400000,
      "needMainCityLevel": 10, "subType": 4, "battleOpenTime": 1791684000000}]');

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
$$;

set local role authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-0000000ec102');
-- 1. An officer names an event.
select lives_ok(
  $$ insert into public.event_names (activity_id, name) values ('41101', 'Ice Pit') $$,
  'an officer names an event');
-- 2. And renames it.
select lives_ok(
  $$ update public.event_names set name = 'Ice Pit (Tundra Titan)' where activity_id = '41101' $$,
  'an officer renames an event');
-- 3. A name that is not an id is refused by the check.
select throws_ok(
  $$ insert into public.event_names (activity_id, name) values ('ice', 'x') $$,
  '23514', null, 'an activity id must be numeric');

select pg_temp.as_user('00000000-0000-4000-8000-0000000ec101');
-- 4. A member reads the newest calendar only, one row per event.
select is((select count(*) from public.event_schedule_current where server_id = 580)::int, 3,
  'a member reads the newest calendar, one row per event');
-- 5. The name an officer gave shows up.
select is((select name from public.event_schedule_current where activity_id = '41101'),
  'Ice Pit (Tundra Titan)', 'the officer''s name is on the event');
-- 6. An unnamed event has a null name, not a missing row.
select ok((select name is null from public.event_schedule_current where activity_id = '80002'),
  'an unnamed event is listed with no name');
-- 7. Times come out as timestamps.
select is((select starts_at from public.event_schedule_current where activity_id = '80002'),
  '2026-10-05 02:00:00+00'::timestamptz, 'startTime epoch ms becomes a timestamp');
-- 8. The game's 0 is "no time", not 1970.
select ok((select starts_at is null and ends_at is null
             from public.event_schedule_current where activity_id = '30000'),
  'a zero time is null, not the epoch');
-- 9. Extras stay available as detail.
select is((select (detail ->> 'battleOpenTime')::bigint
             from public.event_schedule_current where activity_id = '80002'),
  1791684000000::bigint, 'timing extras ride along in detail');
-- 10. A member cannot name events.
select throws_ok(
  $$ insert into public.event_names (activity_id, name) values ('80002', 'SvS') $$,
  '42501', null, 'a member cannot name events');
-- 11. Nor write the calendar.
select throws_ok(
  $$ insert into public.event_schedule_snapshots
       (observation_id, source_command, parser_version, idempotency_key, captured_at,
        collector_id, collected_from_server_id, server_id)
     values (gen_random_uuid(), 'init', '1.0.0', 'ec-test:forged', now(),
        '00000000-0000-4000-8000-0000000ec001', 580, 580) $$,
  '42501', null, 'a member cannot write the calendar');

select pg_temp.as_user('00000000-0000-4000-8000-0000000ec103');
-- 12. A viewer reads nothing.
select is((select count(*) from public.event_schedule_current)::int, 0,
  'a viewer does not read the calendar');
reset role;

-- 13. anon has no read on any of it.
select ok(not has_table_privilege('anon', 'public.event_schedule_snapshots', 'select')
          and not has_table_privilege('anon', 'public.event_schedule_current', 'select')
          and not has_table_privilege('anon', 'public.event_names', 'select'),
  'anon cannot read the calendar or its names');

-- 14. Members cannot truncate, whatever default privileges say.
select ok(not has_table_privilege('authenticated', 'public.event_schedule_snapshots', 'truncate')
          and not has_table_privilege('authenticated', 'public.event_names', 'truncate'),
  'authenticated cannot truncate the calendar or its names');

select * from finish();
rollback;
