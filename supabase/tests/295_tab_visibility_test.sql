-- 0295: an admin hides tabs from roles; nobody else can, and an admin cannot be hidden from.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

select is((select count(*)::int from public.tab_visibility where tab_key = 'migration' and not visible), 4,
          'migration starts hidden from viewer, community, member and officer');
select is((select count(*)::int from public.tab_visibility where tab_key = 'migration' and role = 'admin'), 0,
          'and says nothing about admin');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a5f01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tab-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000a5f02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tab-admin@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000a5f01', 'officer'),
  ('00000000-0000-4000-8000-0000000a5f02', 'admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

-- The admin first, so the refusals below cannot be a table that refuses everybody.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a5f02');
select lives_ok(
  $$ insert into public.tab_visibility (tab_key, role, visible) values ('hive', 'member', false) $$,
  'an admin hides a tab from a role');
select throws_ok(
  $$ insert into public.tab_visibility (tab_key, role, visible) values ('hive', 'admin', false) $$,
  '23514', null, 'but not from admins');
select throws_ok(
  $$ insert into public.tab_visibility (tab_key, role, visible) values ('bad key!', 'member', false) $$,
  '23514', null, 'and the key is a plain word');

-- An officer reads the rows and writes none.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a5f01');
select isnt_empty($$ select 1 from public.tab_visibility $$, 'an officer can read the rows');
select throws_ok(
  $$ insert into public.tab_visibility (tab_key, role, visible) values ('map', 'member', false) $$,
  '42501', null, 'but cannot add one');
select is_empty(
  $$ update public.tab_visibility set visible = true where tab_key = 'migration' and role = 'officer' returning 1 $$,
  'nor show the migration tab to officers');

select * from finish();
rollback;
