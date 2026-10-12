-- 0280: an officer says which variant of a pack is ours; a member reads it
-- and cannot change it; anon has nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ef801', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pv-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000ef802', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pv-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000ef801', 'officer', 'pv officer'),
  ('00000000-0000-4000-8000-0000000ef802', 'member', 'pv member')
on conflict (user_id) do update set role = excluded.role;

set local role authenticated;

-- 1-2. An officer chooses a variant and can change their mind.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ef801')::text, true);
select lives_ok(
  $$ insert into public.game_pack_variants (family_key, variant_key)
     values ('Pioneer Package|0.99', 'a1b2c3d4e5f60718') $$,
  'an officer picks the variant');
select lives_ok(
  $$ update public.game_pack_variants set variant_key = 'ffffffff00000000'
      where family_key = 'Pioneer Package|0.99' $$,
  'and changes it');

-- 3. A member reads it.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ef802')::text, true);
select is((select variant_key from public.game_pack_variants
            where family_key = 'Pioneer Package|0.99'),
  'ffffffff00000000', 'a member reads the choice');

-- 4-5. A member cannot write, change or remove one.
select throws_ok(
  $$ insert into public.game_pack_variants (family_key, variant_key) values ('x|1', 'y') $$,
  '42501', null, 'a member cannot choose a variant');
update public.game_pack_variants set variant_key = 'hacked'
 where family_key = 'Pioneer Package|0.99';
select is((select variant_key from public.game_pack_variants
            where family_key = 'Pioneer Package|0.99'),
  'ffffffff00000000', 'nor change one');

-- 6. Anon has nothing.
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.game_pack_variants $$,
  '42501', null, 'anon cannot read the table');
reset role;

select * from finish();
rollback;
