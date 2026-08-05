-- 0069: the email is admin-only, and growth works without a schedule.
--
-- The first half is a §20.2 negative and the reason this file exists: the
-- directory view is SECURITY DEFINER over auth.users, so if its predicate is
-- wrong every member reads every member's email address. That is the most
-- personal data in this database and nothing else exposes it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000ce01', 'directory test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dir-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dir-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dir-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000000d1', 'member', 'dir member'),
  ('00000000-0000-4000-8000-0000000000d2', 'admin', 'dir admin'),
  ('00000000-0000-4000-8000-0000000000d3', 'viewer', 'dir viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- A player captured twice, ten minutes apart. Not a day, not a week: this is
-- the case the fixed baselines cannot answer.
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000000b1'::uuid, 581, 903000581, 'Foreign One');

insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, game_uid, player_id, power)
values
  ('00000000-0000-4000-8000-0000000000f1', 'server.rank', 'test', 'test:dir:s1',
   now() - interval '10 minutes', '00000000-0000-4000-8000-00000000ce01', 580, 581,
   903000581, '00000000-0000-4000-8000-0000000000b1', 1000),
  ('00000000-0000-4000-8000-0000000000f2', 'server.rank', 'test', 'test:dir:s2',
   now(), '00000000-0000-4000-8000-00000000ce01', 580, 581,
   903000581, '00000000-0000-4000-8000-0000000000b1', 1100);

-- THE NEGATIVE. Emails are admin business.
set local role anon;
select throws_ok($$ select * from public.app_user_directory $$, '42501', null,
  'anon: no directory');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000d3');
select is_empty($$ select * from public.app_user_directory $$,
  'a viewer reads no addresses');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000d1');
select is_empty($$ select * from public.app_user_directory $$,
  'nor does an ordinary member — members.manage is the gate, not signing in');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000d2');
select isnt_empty($$ select * from public.app_user_directory $$,
  'an admin does');
select is(
  (select email from public.app_user_directory
   where user_id = '00000000-0000-4000-8000-0000000000d1'),
  'dir-member@test.invalid', 'and gets the address the account signed up with');
-- Nothing else from auth comes with it. A password hash reaching a browser
-- would be the worst outcome this view could have.
select hasnt_column('public', 'app_user_directory', 'encrypted_password',
  'and no password hash');
select hasnt_column('public', 'app_user_directory', 'confirmation_token',
  'and no confirmation token');
reset role;

-- Growth with no fixed interval, for a player nobody captures on a schedule.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000d1');
select is(
  (select round(growth_since_last) from public.player_growth_recent
   where player_id = '00000000-0000-4000-8000-0000000000b1'),
  10::numeric, '1000 to 1100 is 10 percent since the previous reading');
select is(
  (select power_prev from public.player_growth_recent
   where player_id = '00000000-0000-4000-8000-0000000000b1'),
  1000::bigint, 'and the baseline it used comes with it');
-- The point of the view: the 1d/7d baselines cannot answer this at all, and
-- returning null there is correct rather than a bug to work around here.
select is(
  (select growth_1d from public.player_power_growth
   where player_id = '00000000-0000-4000-8000-0000000000b1'),
  null, 'while the daily baseline has nothing to compare against');
reset role;

select * from finish();
rollback;
