-- 0037: who may name a hero, and what the catalogue refuses to accept.
--
-- The write policy is admin-only, so §20.2 wants the negative. It gets the
-- positive too: 0032 shipped a policy with no matching grant and the negative
-- test passed, because "is a member refused?" is answered the same way by a
-- table nobody can write at all.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

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

-- The seed is DATA, not schema — the whole point of 0037 is that an admin
-- edits it. So this file asserts only that the seeded ids are there, and
-- makes every claim about names and classes against rows it inserts itself
-- further down. Asserting "1006 has no name" passed until somebody used the
-- feature and typed one, which is the same fault 19 and 20 had.
set local role anon;
select is((select count(*) from public.heroes
           where hero_id in (1006, 1015, 33005)), 3::bigint,
  'the catalogue holds the ids the evidence produced, including 33005 — '
  'a hero seen only in other players'' lineups and owned by nobody here');
reset role;

-- Everything below owns its rows. 990001 stands in for "a freshly seeded
-- hero" without depending on one staying untouched.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000e0001');
insert into public.heroes (hero_id, troop_class) values (990001, 1);
select is((select name from public.heroes where hero_id = 990001), null,
  'a hero arrives unnamed, because the protocol carries no names');
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
update public.heroes set name = 'Member Was Here' where hero_id = 990001;
select is((select name from public.heroes where hero_id = 990001), null,
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
  $$ update public.heroes set name = 'Pgtap Only Hero' where hero_id = 990001 $$,
  'an admin can name a hero');
select lives_ok(
  $$ insert into public.heroes (hero_id, name, troop_class)
     values (99999, 'Next Season', 2) $$,
  'and can add one that shipped after this migration, without a migration');

-- The mistake this index is for is not two heroes sharing a name in the
-- game; it is the same name typed twice while filling 28 rows in one sitting.
-- The name is deliberately one nobody would type: this runs against a
-- database somebody is naming real heroes in.
select throws_ok(
  $$ insert into public.heroes (hero_id, name) values (990002, 'pgtap only hero') $$,
  '23505', null, 'the same name in a different case is still the same name');
select throws_ok(
  $$ insert into public.heroes (hero_id, name) values (990003, '   ') $$,
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
