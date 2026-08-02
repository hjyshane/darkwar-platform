-- 0045: permissions are rows now, so the tests have to prove three things
-- the old role-in-policy tests could not.
--
--   1. the seed reproduces the old behaviour exactly — this migration is
--      supposed to change who may do what by zero
--   2. flipping a row actually changes what a member may do, because a
--      switch that does not switch anything is the failure this table
--      invites
--   3. every capability a policy names exists in the registry. A typo'd
--      capability returns false and looks exactly like a correct refusal,
--      which is the one bug in here that could sit undetected forever.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000fe001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'perm-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000fe002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'perm-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000fe001', 'admin', 'perm admin'),
  ('00000000-0000-4000-8000-0000000fe002', 'member', 'perm member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- 3. The guard that cannot be written any other way. pg_policies exposes the
-- policy text, so every has_permission('x') anywhere in the schema is
-- checked against the registry.
select is_empty(
  $$ select distinct m[1] as capability
       from pg_policies,
            lateral regexp_matches(
              coalesce(qual, '') || ' ' || coalesce(with_check, ''),
              'has_permission\(''([a-z._]+)''', 'g') as m
      where schemaname = 'public'
        and m[1] not in (select capability from public.capabilities) $$,
  'every capability a policy names exists in the registry');

-- 1. The seed is the old behaviour.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fe002');
select is(public.has_permission('announcement.read'), true,
  'a member could already read member notices, and still can');
select is(public.has_permission('announcement.write'), false,
  'a member could not post one, and still cannot');
select is(public.has_permission('catalogue.write'), false,
  'nor name a hero');
select throws_ok(
  $$ insert into public.heroes (hero_id) values (99801) $$,
  '42501', null, 'and the policy refuses it, not just the function');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fe001');
select is(public.has_permission('catalogue.write'), true,
  'an admin keeps everything it had');
select lives_ok(
  $$ insert into public.heroes (hero_id) values (99802) $$,
  'and can still write, which is what the grant plus policy together mean');
reset role;

-- 2. The switch switches. Granting a member the capability has to change
-- the answer the policy gives, or the table is decoration.
update public.role_permissions set allowed = true
where role = 'member' and capability = 'catalogue.write';

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fe002');
select is(public.has_permission('catalogue.write'), true,
  'the member now has the capability');
select lives_ok(
  $$ insert into public.heroes (hero_id) values (99803) $$,
  'and the policy lets the write through — the grid is not decoration');
reset role;

-- The lock with no handle on the inside.
select throws_ok(
  $$ update public.role_permissions set allowed = false
      where role = 'admin' and capability = 'members.manage' $$,
  '23514', null, 'an admin cannot revoke its own ability to manage members');

-- The rank is a label. If a policy ever starts reading it, this fails, and
-- that is the point: a promotion in game must not hand out write access.
select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') || coalesce(with_check, '')) like '%game_rank%' $$,
  'no policy reads game_rank — it is shown, never enforced');
select has_column('public', 'app_users', 'game_rank',
  'and the column is there to be shown');

select * from finish();
rollback;
