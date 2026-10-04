-- 0225: an officer renames a pack, a member reads it but cannot write it,
-- anon has nothing, nobody truncates.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000e0101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e0-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000e0102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e0-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000e0101', 'officer', 'officer'),
  ('00000000-0000-4000-8000-0000000e0102', 'member', 'member')
on conflict (user_id) do update set role = excluded.role;

set local role authenticated;

-- 1. An officer renames a pack.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000e0101')::text, true);
select lives_ok(
  $$ insert into public.game_pack_names (pack_key, name) values ('580123', 'Doomsday Key Pack') $$,
  'an officer renames a pack');

-- 2. A member reads it.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000e0102')::text, true);
select is((select name from public.game_pack_names where pack_key = '580123'),
  'Doomsday Key Pack', 'a member reads pack names');

-- 3-4. But cannot write or change one.
select throws_ok(
  $$ insert into public.game_pack_names (pack_key, name) values ('pack:9', 'x') $$,
  '42501', null, 'a member cannot rename a pack');
update public.game_pack_names set name = 'changed' where pack_key = '580123';
select is((select name from public.game_pack_names where pack_key = '580123'),
  'Doomsday Key Pack', 'nor change a rename');
reset role;

-- 5-6. Anon has nothing; authenticated cannot truncate.
select ok(not has_table_privilege('anon', 'public.game_pack_names', 'select'),
  'anon has no read');
select ok(not has_table_privilege('authenticated', 'public.game_pack_names', 'truncate'),
  'authenticated cannot truncate');

select * from finish();
rollback;
