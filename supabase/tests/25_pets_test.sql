-- 0044: the pet catalogue follows the hero one, so its RLS has to as well.
--
-- Shorter than 24 on purpose: the policies are the same two, written the same
-- way, and what this file is really pinning is that they were actually
-- attached to this table. 0032 is the reason that is worth its own test — a
-- policy with no matching grant refuses everybody, and a negative test alone
-- cannot tell that apart from working correctly.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000fa001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pet-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000fa002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pet-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000fa001', 'admin', 'pet admin'),
  ('00000000-0000-4000-8000-0000000fa002', 'member', 'pet member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- The seed is data an admin edits, so this asserts the ids exist and says
-- nothing about their names — 24 learned that the hard way.
set local role anon;
select is((select count(*) from public.pets where pet_id between 101 and 107), 7::bigint,
  'the seven pets the user named are in the catalogue');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fa002');
select throws_ok(
  $$ insert into public.pets (pet_id) values (99901) $$,
  '42501', null, 'a member cannot add a pet');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fa001');
select lives_ok(
  $$ insert into public.pets (pet_id, name) values (99901, 'Pgtap Only Pet') $$,
  'an admin can, which is what proves the grant exists and not just the policy');
select throws_ok(
  $$ insert into public.pets (pet_id, name) values (99902, 'pgtap only pet') $$,
  '23505', null, 'the same name in a different case is still the same name');
select throws_ok(
  $$ insert into public.pets (pet_id, name) values (99903, '  ') $$,
  '23514', null, 'whitespace is not a name; null is how you say "not yet"');
reset role;

-- Renaming a pet has to reach the cross-server board that prints it.
select is((select count(*) from public.data_change_notifications
           where topic = 'pets') > 0, true,
  'a write notifies subscribers');

select * from finish();
rollback;
