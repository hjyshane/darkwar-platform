-- 0037: who may name a hero, and what the catalogue refuses to accept.
--
-- The write policy is admin-only, so §20.2 wants the negative. It gets the
-- positive too: 0032 shipped a policy with no matching grant and the negative
-- test passed, because "is a member refused?" is answered the same way by a
-- table nobody can write at all.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hero-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000e0002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hero-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000e0001', 'admin', 'hero admin'),
  ('00000000-0000-4000-8000-0000000e0002', 'member', 'hero member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- The seed, spot-checked by id rather than by counting the table: an admin
-- adding next season's hero must not break this file.
set local role anon;
select is((select troop_class from public.heroes where hero_id = 1006), 1::smallint,
  'a hero fielded 695 times is seeded with the class those sightings agree on');
select is((select troop_class from public.heroes where hero_id = 1015), null,
  'a hero nobody observed has ever fielded gets a null class, not a guess');
select is((select count(*) from public.heroes where hero_id = 33005), 1::bigint,
  'a hero seen only in other players'' lineups is in the catalogue too');
select is((select name from public.heroes where hero_id = 1006), null,
  'and no hero arrives named, because the protocol carries no names');
reset role;

-- Writing.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000e0002');
select throws_ok(
  $$ insert into public.heroes (hero_id) values (99999) $$,
  '42501', null, 'a member cannot add a hero');
-- Same asymmetry as announcements: an UPDATE is filtered to the rows the
-- caller can see, so a member's update matches nothing and reports success.
-- The assertion has to be that the row did not change.
update public.heroes set name = 'Member Was Here' where hero_id = 1006;
select is((select name from public.heroes where hero_id = 1006), null,
  'a member''s rename silently changes nothing rather than erroring');
reset role;

set local role anon;
select throws_ok(
  $$ insert into public.heroes (hero_id) values (99999) $$,
  '42501', null, 'anon cannot add one either');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000e0001');
select lives_ok(
  $$ update public.heroes set name = 'Ivan' where hero_id = 1006 $$,
  'an admin can name a hero');
select lives_ok(
  $$ insert into public.heroes (hero_id, name, troop_class)
     values (99999, 'Next Season', 2) $$,
  'and can add one that shipped after this migration, without a migration');

-- The mistake this index is for is not two heroes sharing a name in the
-- game; it is the same name typed twice while filling 28 rows in one sitting.
select throws_ok(
  $$ update public.heroes set name = 'ivan' where hero_id = 1008 $$,
  '23505', null, 'the same name in a different case is still the same name');
select throws_ok(
  $$ update public.heroes set name = '   ' where hero_id = 1008 $$,
  '23514', null, 'whitespace is not a name; null is how you say "not yet"');

-- Deliberately unconstrained. troops.ts renders an unrecognised class as
-- itself on the grounds that a fourth class would be news, and news should
-- not arrive as a failed insert on the admin page.
select lives_ok(
  $$ insert into public.heroes (hero_id, troop_class) values (99998, 4) $$,
  'a fourth troop class is recordable without a migration');
reset role;

-- A rename has to reach the arena board, which prints these names.
select is((select count(*) from public.data_change_notifications
           where topic = 'heroes') > 0, true,
  'a write notifies subscribers');

select * from finish();
rollback;
