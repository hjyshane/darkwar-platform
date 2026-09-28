-- 0192: phase 1 of multi-alliance. Additive only, so most of this file checks
-- that nothing moved: the legacy single pin still resolves, a member still
-- lands in the pinned alliance, an insert that never heard of alliance_id
-- still gets one. Plus the one new read policy and its negative (§20.2).
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000b1001', 580, 'ext-ma-one', 'One', 'ONE'),
  ('00000000-0000-4000-8000-0000000b1002', 581, 'ext-ma-two', 'Two', 'TWO'),
  ('00000000-0000-4000-8000-0000000b1003', 582, 'ext-ma-three', 'Three', 'THR');

-- A database somebody has used may already hold a pin; arrange "ours".
delete from public.app_settings where key = 'own_alliance';

-- 1-2. The legacy single-id form still resolves, and primary follows it.
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-0000000b1001"}');

select is(
  (select array_agg(current_code order by current_code) from public.alliances
    where alliance_id::text like '00000000-0000-4000-8000-0000000b100%' and is_own),
  array['ONE'],
  'the legacy {alliance_id} pin still resolves is_own');
select is(public.primary_own_alliance(), '00000000-0000-4000-8000-0000000b1001'::uuid,
  'primary_own_alliance follows the legacy pin');

-- 3-4. The list form marks every listed alliance, and primary is the first.
update public.app_settings
set value = '{"alliance_ids": ["00000000-0000-4000-8000-0000000b1002",
                               "00000000-0000-4000-8000-0000000b1001"]}'
where key = 'own_alliance';

select is(
  (select array_agg(current_code order by current_code) from public.alliances
    where alliance_id::text like '00000000-0000-4000-8000-0000000b100%' and is_own),
  array['ONE', 'TWO'],
  'the {alliance_ids} pin marks every listed alliance as own');
select is(public.primary_own_alliance(), '00000000-0000-4000-8000-0000000b1002'::uuid,
  'primary_own_alliance is the first of the list, not the lowest id');

-- Back to one, which is what production holds until phase 5.
update public.app_settings
set value = '{"alliance_id": "00000000-0000-4000-8000-0000000b1001"}'
where key = 'own_alliance';

-- 5-8. The mirror: app_users.role still decides, the membership follows.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000b2001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ma-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000b2002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ma-other@test.invalid');

insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-0000000b2001', 'member', 'ma member'),
       ('00000000-0000-4000-8000-0000000b2002', 'member', 'ma other');

select is(
  (select role::text from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000b2001'
      and alliance_id = '00000000-0000-4000-8000-0000000b1001'),
  'member',
  'a new member gets a membership in the pinned alliance');

update public.app_users set role = 'officer'
where user_id = '00000000-0000-4000-8000-0000000b2001';
select is(
  (select role::text from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000b2001'),
  'officer',
  'a promotion follows into the membership');

update public.app_users set role = 'viewer'
where user_id = '00000000-0000-4000-8000-0000000b2002';
-- Asserted by count, not by a null role: a null-expecting check passes when
-- the row is missing, which is the very thing being tested here.
select is(
  (select count(*)::int from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000b2002'),
  0,
  'a demotion to viewer drops the membership');

select throws_ok(
  $$ insert into public.alliance_memberships (user_id, alliance_id, role)
     values ('00000000-0000-4000-8000-0000000b2001',
             '00000000-0000-4000-8000-0000000b1002', 'admin') $$,
  '23514', null,
  'admin is never a membership; it stays global');

-- 9-10. Read policy: yourself yes, somebody else no.
update public.app_users set role = 'member'
where user_id = '00000000-0000-4000-8000-0000000b2002';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000b2002')::text, true);

select is(
  (select count(*)::int from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000b2002'),
  1,
  'a member can read their own membership');
select is(
  (select count(*)::int from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000b2001'),
  0,
  'a member cannot read somebody else''s membership');
select throws_ok(
  $$ insert into public.alliance_memberships (user_id, alliance_id, role)
     values ('00000000-0000-4000-8000-0000000b2002',
             '00000000-0000-4000-8000-0000000b1002', 'officer') $$,
  '42501', null,
  'a member cannot write themselves into another alliance');
reset role;

-- 11-15. An insert that never mentions alliance_id lands in the pinned one.
insert into public.announcements (title, body)
values ('ma phase 1 notice', 'body');
select is(
  (select alliance_id from public.announcements where title = 'ma phase 1 notice'),
  '00000000-0000-4000-8000-0000000b1001'::uuid,
  'an announcement defaults to the pinned alliance');

select has_column('public', 'join_codes', 'alliance_id', 'join codes carry an alliance');
select has_column('public', 'schedule_events', 'alliance_id', 'schedule events carry an alliance');
select has_column('public', 'hive_formations', 'alliance_id', 'hive formations carry an alliance');
select hasnt_column('public', 'hive_map_features', 'alliance_id',
  'the map-feature catalogue stays shared: a building is the same size for everyone');

select * from finish();
rollback;
