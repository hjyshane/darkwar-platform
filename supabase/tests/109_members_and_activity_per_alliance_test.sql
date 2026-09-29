-- 0201: an admin's members list and everybody's activity screen show the
-- alliance on screen, not the install.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

update public.alliances set is_own = false, roster_unredacted_seen = false
 where is_own or roster_unredacted_seen;
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000b9001', 580, 'ext-ma-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000b9002', 581, 'ext-ma-b', 'Bravo', 'BBB');

delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000b9001",
                                           "00000000-0000-4000-8000-0000000b9002"]}');

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000b9101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ma-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000b9102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ma-a@test.invalid'),
  ('00000000-0000-4000-8000-0000000b9103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ma-b@test.invalid'),
  ('00000000-0000-4000-8000-0000000b9104', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ma-both@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000b9101', 'admin', 'ma admin'),
  ('00000000-0000-4000-8000-0000000b9102', 'member', 'ma a'),      -- mirror: Alpha
  ('00000000-0000-4000-8000-0000000b9103', 'viewer', 'ma b'),
  ('00000000-0000-4000-8000-0000000b9104', 'member', 'ma both');   -- mirror: Alpha
insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-0000000b9103', '00000000-0000-4000-8000-0000000b9002', 'member'),
  ('00000000-0000-4000-8000-0000000b9104', '00000000-0000-4000-8000-0000000b9002', 'member');

create function pg_temp.as_user(p_uid uuid, p_alliance uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true),
         set_config('request.headers',
           case when p_alliance is null then '{}'
                else json_build_object('x-alliance-id', p_alliance)::text end, true);
$$;

set local role authenticated;

-- 1-2. The admin's members list follows the alliance on screen.
select pg_temp.as_user('00000000-0000-4000-8000-0000000b9101', '00000000-0000-4000-8000-0000000b9002');
select is(
  (select array_agg(display_name order by display_name) from public.app_user_directory
    where display_name like 'ma %'),
  array['ma admin', 'ma b', 'ma both'],
  'an admin viewing Bravo lists Bravo''s accounts, not Alpha''s');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b9101', '00000000-0000-4000-8000-0000000b9001');
select is(
  (select array_agg(display_name order by display_name) from public.app_user_directory
    where display_name like 'ma %'),
  array['ma a', 'ma admin', 'ma both'],
  'and viewing Alpha, Alpha''s');

-- 3. A member of both records a sign-in in each alliance, once a day each.
select pg_temp.as_user('00000000-0000-4000-8000-0000000b9104', '00000000-0000-4000-8000-0000000b9001');
insert into public.activity_events (user_id, kind)
values ('00000000-0000-4000-8000-0000000b9104', 'login');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b9104', '00000000-0000-4000-8000-0000000b9002');
insert into public.activity_events (user_id, kind)
values ('00000000-0000-4000-8000-0000000b9104', 'login'),
       ('00000000-0000-4000-8000-0000000b9104', 'rank_server');
select is(
  (select count(*)::int from public.activity_events
    where user_id = '00000000-0000-4000-8000-0000000b9104'),
  3, 'an action is recorded in the alliance it happened in');

-- 4. A browser cannot record into an alliance it is not viewing.
select throws_ok(
  $$ insert into public.activity_events (user_id, kind, alliance_id)
     values ('00000000-0000-4000-8000-0000000b9104', 'rank_player',
             '00000000-0000-4000-8000-0000000b9001') $$,
  '42501', null,
  'and not into another alliance');

-- 5-6. The admin's activity screen counts the alliance on screen only.
select pg_temp.as_user('00000000-0000-4000-8000-0000000b9101', '00000000-0000-4000-8000-0000000b9002');
select is(
  (select sum(login_days + server_days)::int from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b9104'),
  2, 'viewing Bravo counts what was done in Bravo');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b9101', '00000000-0000-4000-8000-0000000b9001');
select is(
  (select sum(login_days + server_days)::int from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b9104'),
  1, 'viewing Alpha, what was done in Alpha');

-- 7-8. The list of people follows the alliance and the role there.
select pg_temp.as_user('00000000-0000-4000-8000-0000000b9101', '00000000-0000-4000-8000-0000000b9002');
select is(
  (select array_agg(display_name order by display_name) from public.activity_members
    where display_name like 'ma %'),
  array['ma admin', 'ma b', 'ma both'],
  'Bravo''s activity list names Bravo''s members, a viewer-in-CBFW among them');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b9101', '00000000-0000-4000-8000-0000000b9001');
select is(
  (select array_agg(display_name order by display_name) from public.activity_members
    where display_name like 'ma %'),
  array['ma a', 'ma admin', 'ma both'],
  'Alpha''s names Alpha''s');
reset role;

select * from finish();
rollback;
