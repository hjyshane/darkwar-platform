-- 0286: the planner's building set for an account with no login.
-- Ids only, level 1 and above, from any account's login; closed to anon.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000fe001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pb@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000fe001', 'community');

insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-0000000fec01', 'pb probe');
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000feb01', 580, 9800000001000580, 'PbProbe');

insert into public.account_state_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, buildings)
values
  ('00000000-0000-4000-8000-0000000fee01', 'user.get.info', '1', 'test:pb:1',
   '2026-08-08T12:00:00Z', '00000000-0000-4000-8000-0000000fec01', 580,
   '00000000-0000-4000-8000-0000000feb01', 580, 9800000001000580,
   '{"900001": 12, "900002": 0, "900003": 1}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000fe001","role":"authenticated"}', true);

select is(
  (select count(*) from public.account_state_snapshots),
  0::bigint, 'a community account cannot read account state itself');

select results_eq(
  $$ select b from public.planner_building_ids() b where b like '9000%' order by 1 $$,
  $$ values ('900001'::text), ('900003') $$,
  'but is told which buildings accounts have, at level 1 and above');
reset role;

set local role anon;
select throws_ok($$ select * from public.planner_building_ids() $$, '42501', null,
  'anon may not ask');
reset role;

select is(
  (select pg_get_function_result('public.planner_building_ids()'::regprocedure)),
  'SETOF text', 'and what it returns is ids only');

select * from finish();
rollback;
