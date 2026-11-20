-- 0338: event_names carries the game's summary and rules.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000000337101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'text-member@test.invalid'),
  ('00000000-0000-4000-8000-000000337102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'text-officer@test.invalid'),
  ('00000000-0000-4000-8000-000000337103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'text-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-000000337101', 'member', 'text member'),
  ('00000000-0000-4000-8000-000000337102', 'officer', 'text officer'),
  ('00000000-0000-4000-8000-000000337103', 'viewer', 'text viewer')
on conflict (user_id) do update set role = excluded.role;

-- The tool's write: the service key, name and text together.
set local role service_role;
insert into public.event_names (activity_id, name, activity_type, category, summary, rules)
values ('41101', 'Arctic Ice Pit', 126, 'season',
  'Beat Tundra Titan to start your Ice Fishing adventure!',
  E'Conquest Rules:\n1. The ice thaws at 12:00:00.');
reset role;

-- 1-2. A member reads the text with the name.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000000337101')::text, true);
set local role authenticated;
select is((select count(*) from public.event_names where activity_id = '41101'), 1::bigint,
  'a member sees the row');
select is((select summary from public.event_names where activity_id = '41101'),
  'Beat Tundra Titan to start your Ice Fishing adventure!',
  'and reads the game''s summary');
-- 3. ...and cannot rewrite it: no row is theirs to update.
update public.event_names set rules = 'made up' where activity_id = '41101';
reset role;
select is((select rules from public.event_names where activity_id = '41101'),
  E'Conquest Rules:\n1. The ice thaws at 12:00:00.',
  'a member''s update of the rules changes nothing');

-- 4. Somebody not yet let in reads nothing.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000000337103')::text, true);
set local role authenticated;
select is((select count(*) from public.event_names where activity_id = '41101'), 0::bigint,
  'a viewer cannot read the text');
reset role;
-- 5. Nor does anon have the table at all.
select ok(not has_table_privilege('anon', 'public.event_names', 'select'),
  'anon cannot read event_names');

-- 6. An officer's rename keeps the text: the dashboard's upsert names only
-- the name and the category.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000000337102')::text, true);
set local role authenticated;
insert into public.event_names (activity_id, name, category)
values ('41101', 'Ice Pit', 'season')
on conflict (activity_id) do update set name = excluded.name, category = excluded.category;
reset role;
select is(
  (select name || ' / ' || summary from public.event_names where activity_id = '41101'),
  'Ice Pit / Beat Tundra Titan to start your Ice Fishing adventure!',
  'a rename leaves the summary in place');

-- 7. The length checks hold.
select throws_ok(
  $$ update public.event_names set summary = repeat('x', 2001) where activity_id = '41101' $$,
  '23514', null, 'an over-long summary is refused');

select * from finish();
rollback;
