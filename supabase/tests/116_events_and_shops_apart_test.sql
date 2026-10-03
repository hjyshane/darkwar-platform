-- 0210: event_names carries a category the calendar view exposes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ed001', 'events-and-shops-test');
insert into public.event_schedule_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, events)
values (gen_random_uuid(), 'init', '1.0.0', 'es-test:1', now(),
  '00000000-0000-4000-8000-0000000ed001', 580, 580,
  '[{"id": "111001", "startTime": 1791028800000, "endTime": 1791201600000},
    {"id": "300004", "startTime": 1790906400000, "endTime": 1791165600000}]');
insert into public.event_names (activity_id, name, activity_type, category) values
  ('111001', 'Capital Clash', 54, 'event'),
  ('300004', 'Mod Vehicle Combo Pack', 274, 'shop');

-- 1-2. The view carries the category and the type.
select is((select category from public.event_schedule_current where activity_id = '300004'),
  'shop', 'a pack is a shop entry');
select is((select activity_type from public.event_schedule_current where activity_id = '111001'),
  54, 'the activity type rides along');
-- 3. Only the two categories exist.
select throws_ok(
  $$ update public.event_names set category = 'gacha' where activity_id = '300004' $$,
  '23514', null, 'an unknown category is refused');
-- 4. The recreated view still refuses anon.
select ok(not has_table_privilege('anon', 'public.event_schedule_current', 'select'),
  'anon still cannot read the calendar');

-- 5-6. An officer renaming a row the game tool wrote becomes its owner, so
-- the next tool run leaves it alone; the tool's own write stays ownerless.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ed101', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'es-officer@test.invalid');
insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-0000000ed101', 'officer', 'es officer')
on conflict (user_id) do update set role = excluded.role;

set local role service_role;
update public.event_names set name = 'Capital Clash (game)' where activity_id = '111001';
reset role;
select ok((select updated_by is null from public.event_names where activity_id = '111001'),
  'a write by the collector key leaves the row ownerless');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ed101')::text, true);
set local role authenticated;
update public.event_names set name = 'Capital' where activity_id = '111001';
reset role;
select is((select updated_by from public.event_names where activity_id = '111001'),
  '00000000-0000-4000-8000-0000000ed101'::uuid,
  'an officer''s rename makes the row theirs');

select * from finish();
rollback;
