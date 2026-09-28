-- 0195: an officer manages their own alliance's people and settings, and
-- nothing else — and cannot make themselves admin.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- Fixtures ------------------------------------------------------------------

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000e1001', 580, 'ext-ms-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000e1002', 581, 'ext-ms-b', 'Bravo', 'BBB');

delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000e1001",
                                           "00000000-0000-4000-8000-0000000e1002"]}');
delete from public.app_settings where key = 'rank_tiers';
insert into public.app_settings (key, value) values ('rank_tiers', '{"who": "primary"}');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-0000000e2001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ms-admin@test.invalid', null),
  ('00000000-0000-4000-8000-0000000e2002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ms-off-a@test.invalid', null),
  ('00000000-0000-4000-8000-0000000e2003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ms-off-b@test.invalid', null),
  ('00000000-0000-4000-8000-0000000e2004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ms-both@test.invalid', null),
  ('00000000-0000-4000-8000-0000000e2005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ms-member-a@test.invalid', null),
  ('00000000-0000-4000-8000-0000000e2006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ms-wants-b@test.invalid',
   '{"alliance_id": "00000000-0000-4000-8000-0000000e1002"}');

insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000e2001', 'admin', 'ms admin'),
  ('00000000-0000-4000-8000-0000000e2002', 'officer', 'ms off a'),   -- mirror: Alpha
  ('00000000-0000-4000-8000-0000000e2003', 'viewer', 'ms off b'),
  ('00000000-0000-4000-8000-0000000e2004', 'member', 'ms both'),     -- mirror: Alpha
  ('00000000-0000-4000-8000-0000000e2005', 'member', 'ms member a'); -- mirror: Alpha
insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-0000000e2003', '00000000-0000-4000-8000-0000000e1002', 'officer'),
  ('00000000-0000-4000-8000-0000000e2004', '00000000-0000-4000-8000-0000000e1002', 'member');

-- The case this migration is for: an admin hands officers the member and
-- settings switches.
update public.role_permissions set allowed = true
where role = 'officer' and capability in ('members.manage', 'settings.write');

create function pg_temp.as_user(p_uid uuid, p_alliance uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true),
         set_config('request.headers',
           case when p_alliance is null then '{}'
                else json_build_object('x-alliance-id', p_alliance)::text end, true);
$$;

create function pg_temp.fixture_names() returns text[] language sql as $$
  select array_agg(display_name order by display_name) from public.app_user_directory
  where display_name like 'ms %'
$$;

set local role authenticated;

-- The directory -------------------------------------------------------------

-- 1-3. Each officer sees their own alliance; the admin sees everybody.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2003', null);
select is(pg_temp.fixture_names(), array['ms both', 'ms off b'],
  'an officer of Bravo lists Bravo''s accounts only');
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2002', null);
-- The admin holds no membership, and an account with none belongs to the
-- primary's screen — so Alpha's officer lists them and Bravo's does not.
select is(pg_temp.fixture_names(), array['ms admin', 'ms both', 'ms member a', 'ms off a'],
  'an officer of Alpha lists Alpha''s');
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e1002');
select is(pg_temp.fixture_names(),
  array['ms admin', 'ms both', 'ms member a', 'ms off a', 'ms off b'],
  'an admin lists every account');

-- 4. And says what each is in the alliance on screen.
select is(
  (select alliance_role::text from public.app_user_directory where display_name = 'ms off b'),
  'officer',
  'the directory gives the role in the alliance being viewed');

-- Writing accounts ----------------------------------------------------------

-- 5. Another alliance's account is out of reach entirely.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2003', null);
update public.app_users set display_name = 'ms defaced'
where user_id = '00000000-0000-4000-8000-0000000e2005';
reset role;
select is(
  (select display_name from public.app_users where user_id = '00000000-0000-4000-8000-0000000e2005'),
  'ms member a',
  'an officer of Bravo cannot touch a member of Alpha only');
set local role authenticated;

-- 6. THE ESCALATION: members.manage used to include writing role = 'admin'.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2003', null);
select throws_ok(
  $$ update public.app_users set role = 'admin'
      where user_id = '00000000-0000-4000-8000-0000000e2003' $$,
  '42501', null,
  'an officer cannot make themselves admin');

-- 7. Nor anybody else.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2002', null);
select throws_ok(
  $$ update public.app_users set role = 'admin'
      where user_id = '00000000-0000-4000-8000-0000000e2005' $$,
  '42501', null,
  'an officer cannot make a member admin');

-- 8. The legacy screen's path still works while viewing the primary.
select lives_ok(
  $$ update public.app_users set role = 'officer'
      where user_id = '00000000-0000-4000-8000-0000000e2005' $$,
  'an officer of the primary may still promote there');

-- 9. But app_users.role is the PRIMARY's role; Bravo's officer cannot move it.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2003', null);
select throws_ok(
  $$ update public.app_users set role = 'viewer'
      where user_id = '00000000-0000-4000-8000-0000000e2004' $$,
  '42501', null,
  'an officer of Bravo cannot change somebody''s Alpha role');

-- 10-11. Removal: not somebody who is also elsewhere; yes somebody who is not.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2002', null);
select throws_ok(
  $$ select public.remove_member('00000000-0000-4000-8000-0000000e2004') $$,
  '42501', null,
  'removing an account that also belongs to Bravo is refused');
select lives_ok(
  $$ select public.remove_member('00000000-0000-4000-8000-0000000e2005') $$,
  'removing an Alpha-only account works');

-- Leaving one of two ----------------------------------------------------------

-- 12-13. In both, viewing Bravo: leave Bravo, keep Alpha.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2004', '00000000-0000-4000-8000-0000000e1002');
select throws_ok(
  $$ select public.leave_alliance() $$,
  '42501', null,
  'leaving everything at once is refused while in two alliances');
select public.leave_active_alliance();
reset role;
select is(
  (select array_agg(alliance_id::text) from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000e2004'),
  array['00000000-0000-4000-8000-0000000e1001'],
  'leave_active_alliance leaves Bravo and keeps Alpha');
set local role authenticated;

-- 14. Leaving the last one is leaving.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2004', null);
select public.leave_active_alliance();
reset role;
select is(
  (select count(*)::int from public.app_users where user_id = '00000000-0000-4000-8000-0000000e2004'),
  0,
  'leaving the only alliance left removes the account row, as 0094 did');
set local role authenticated;

-- Settings ------------------------------------------------------------------

-- 15-17. Bravo gets its own rank tiers; Alpha keeps app_settings.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2003', null);
select public.save_alliance_setting('rank_tiers', '{"who": "bravo"}');
select is(public.alliance_setting('rank_tiers') ->> 'who', 'bravo',
  'Bravo reads its own tiers');
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2002', null);
select is(public.alliance_setting('rank_tiers') ->> 'who', 'primary',
  'Alpha still reads app_settings');
reset role;
select is((select value ->> 'who' from public.app_settings where key = 'rank_tiers'), 'primary',
  'and Bravo''s save did not touch app_settings');
set local role authenticated;

-- 18. The primary's save IS app_settings, so today's readers see it.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2002', null);
select public.save_alliance_setting('rank_tiers', '{"who": "alpha edited"}');
reset role;
select is((select value ->> 'who' from public.app_settings where key = 'rank_tiers'),
  'alpha edited',
  'the primary''s save writes app_settings');
set local role authenticated;

-- 19. Shared settings are not per alliance.
select throws_ok(
  $$ select public.save_alliance_setting('overview_formulas', '{}') $$,
  '22023', null,
  'a shared setting cannot be overridden per alliance');

-- The waiting list ----------------------------------------------------------

-- 20-22. Somebody asking for Bravo: Bravo's officer sees them with their
-- address, Alpha's does not, and an account without members.manage sees no one.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2003', null);
select is(
  (select email from public.waiting_to_join()
    where user_id = '00000000-0000-4000-8000-0000000e2006'),
  'ms-wants-b@test.invalid',
  'an officer of Bravo sees who is asking for Bravo');
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2002', null);
select is(
  (select count(*)::int from public.waiting_to_join()
    where user_id = '00000000-0000-4000-8000-0000000e2006'),
  0,
  'an officer of Alpha does not');
-- The regression this function was nearly written with: built on
-- pending_access, whose service disjunct is always true under definer.
select pg_temp.as_user('00000000-0000-4000-8000-0000000e2006', null);
select is((select count(*)::int from public.waiting_to_join()), 0,
  'an account without members.manage sees nobody, and no addresses');

reset role;
select * from finish();
rollback;
