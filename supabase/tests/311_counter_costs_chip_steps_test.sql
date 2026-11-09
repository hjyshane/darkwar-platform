-- 0309: a cost may be a counter (chip EXP points, duplicates), vehicle chips
-- are a kind, a season building says which game season it is, and an EXP
-- card says what it is worth. Community reads the new kind; anon reads none.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000c3091', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chips-community@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000c3091', 'community', 'chips community');

-- The collector's key writes the catalogue (pgTAP otherwise runs as the owner,
-- which no grant can stop).
set local role service_role;

select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, name, costs)
     values ('chip', '4', 1, '0★ 1/10',
             '[{"type":"counter","id":"chip_exp","amount":500}]') $$,
  'a chip step costing EXP points inserts');
select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, name, costs)
     values ('chip', '4', 10, '1★ 0/10',
             '[{"type":"counter","id":"chip_duplicate:4","amount":1}]') $$,
  'a chip step costing a duplicate inserts');
select throws_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs)
     values ('building', '999000', 1, '[{"type":"gold","id":"1","amount":5}]') $$,
  '23514', null, 'a cost type the planner does not know is refused');
select throws_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs)
     values ('chip', '5', 1, '[{"type":"counter","id":7,"amount":5}]') $$,
  '23514', null, 'a counter id is text');
select throws_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs)
     values ('building', '999000', 1, '[{"type":"item","id":"1"}]') $$,
  '23514', null, 'every cost has an amount');

select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, name, game_season)
     values ('building', '868000', 1, 'Mineral Factory I', 6),
            ('building', '868000', 2, 'Mineral Factory I', 6) $$,
  'a season building carries the game''s season');
select is(
  (select game_season from public.game_upgrade_subjects
    where kind = 'building' and subject_id = '868000'),
  6, 'the subjects view says which game season a building belongs to');

select lives_ok(
  $$ insert into public.game_items (item_id, name, counter_value)
     values ('300030', 'Chip Star-Up EXP Card (Big)', '{"id":"chip_exp","amount":60000}') $$,
  'an EXP card says what it is worth');
select throws_ok(
  $$ insert into public.game_items (item_id, counter_value) values ('300031', '[60000]') $$,
  '23514', null, 'a counter value is an object with an id and an amount');

reset role;

-- A community account reads the new kind like every other game table (0283).
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000c3091');
select is(
  (select count(*)::int from public.game_upgrade_steps where kind = 'chip'),
  2, 'community reads chip steps');
reset role;

set local role anon;
select throws_ok(
  $$ select count(*) from public.game_upgrade_steps where kind = 'chip' $$,
  '42501', null, 'anon reads no chip steps');
reset role;

select * from finish();
rollback;
