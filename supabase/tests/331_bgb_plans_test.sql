-- 0331: Black Gold plans. Who may write them, that only a starter of the
-- team can be placed, that a stale save and another alliance are refused, and
-- that delete and restore behave as the hive's do.
--
-- The refusals are the point: each is a way a plan used to be — or in the hive
-- once was — changed by somebody who should not, or over somebody's work.
begin;
create extension if not exists pgtap with schema extensions;

select plan(55);

-- ---------------------------------------------------------------------------
-- Fixtures: one own alliance and one stranger, four players, two signup
-- readings (the older one has Cara as a starter; in the newer she is a
-- substitute), and accounts whose role decides has_permission.

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own) values
  ('00000000-0000-4000-8000-0000003310a1', 580, 'ext-331', 'BgbOurs', true),
  ('00000000-0000-4000-8000-0000003310a2', 580, 'ext-331-other', 'BgbElsewhere', false);
-- Pinned, so the primary (and the alliance a new plan lands in) is this
-- fixture's, whatever else in the database is marked own.
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000003310a1"]}');
insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-0000003310b1', 580, 9331000000000001, 'Ann', 90),
  ('00000000-0000-4000-8000-0000003310b2', 580, 9331000000000002, 'Ben', 80),
  ('00000000-0000-4000-8000-0000003310b3', 580, 9331000000000003, 'Cara', 70),
  ('00000000-0000-4000-8000-0000003310b4', 580, 9331000000000004, 'Dan', 60);

-- One captured_at per batch: the latest reading is the rows sharing the newest
-- instant. Older reading 12:00: Ann, Cara starters of A. Newer 13:00: Ann, Ben
-- starters of A, Cara a substitute of A, Dan a starter of B.
insert into public.black_money_signup_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid, name,
   state, team_index)
values
  ('00000000-0000-4000-8000-00000000f331', 'dragon.assign.player.info', 'test',
   't:bgb:old:1', '2026-11-16T12:00:00Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, '00000000-0000-4000-8000-0000003310b1', 9331000000000001, 'Ann', 1, 1),
  ('00000000-0000-4000-8000-00000000f331', 'dragon.assign.player.info', 'test',
   't:bgb:old:2', '2026-11-16T12:00:00Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, '00000000-0000-4000-8000-0000003310b3', 9331000000000003, 'Cara', 1, 1),
  ('00000000-0000-4000-8000-00000000f332', 'dragon.assign.player.info', 'test',
   't:bgb:new:1', '2026-11-16T13:00:00Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, '00000000-0000-4000-8000-0000003310b1', 9331000000000001, 'Ann', 1, 1),
  ('00000000-0000-4000-8000-00000000f332', 'dragon.assign.player.info', 'test',
   't:bgb:new:2', '2026-11-16T13:00:00Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, '00000000-0000-4000-8000-0000003310b2', 9331000000000002, 'Ben', 1, 1),
  ('00000000-0000-4000-8000-00000000f332', 'dragon.assign.player.info', 'test',
   't:bgb:new:3', '2026-11-16T13:00:00Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, '00000000-0000-4000-8000-0000003310b3', 9331000000000003, 'Cara', 2, 1),
  ('00000000-0000-4000-8000-00000000f332', 'dragon.assign.player.info', 'test',
   't:bgb:new:4', '2026-11-16T13:00:00Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, '00000000-0000-4000-8000-0000003310b4', 9331000000000004, 'Dan', 1, 2);

-- Our roster, one batch: since 0332 a reading counts as ours only when most
-- of the players it names are on it.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id, game_uid, name)
select '00000000-0000-4000-8000-00000000f330', 'al.rank', 'test', 't:bgb:roster:' || p.game_uid,
       '2026-11-16T11:00:00Z', '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-0000003310a1', 580, p.player_id, p.game_uid, p.current_name
  from public.players p
 where p.player_id::text like '00000000-0000-4000-8000-0000003310b%';

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000003310c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bgb-member@test.invalid'),
  ('00000000-0000-4000-8000-0000003310c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bgb-officer@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000003310c2', 'member', 'bgb member', null),
  ('00000000-0000-4000-8000-0000003310c3', 'officer', 'bgb officer', null);

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Shape.

select has_table('public', 'bgb_plans', 'bgb_plans exists');
select has_table('public', 'bgb_plan_assignments', 'bgb_plan_assignments exists');
select has_column('public', 'bgb_plans', c.col, 'bgb_plans has ' || c.col)
from unnest(array['alliance_id', 'team_index', 'is_live', 'version', 'edited_by_name',
                  'deleted_at']) as c(col);
select col_is_unique('public', 'bgb_plan_assignments', array['plan_id', 'player_id'],
  'a person holds one place in a plan');

-- ---------------------------------------------------------------------------
-- Creating a plan: officers only, and the trigger writes what a forger wants.

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c2');
select throws_ok(
  $$ insert into public.bgb_plans (plan_id, team_index, name)
     values ('00000000-0000-4000-8000-0000003310d0', 1, 'Member plan') $$,
  '42501', null,
  'a member cannot create a plan');

select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');
insert into public.bgb_plans
  (plan_id, team_index, name, version, is_live, deleted_at, edited_by_name)
values ('00000000-0000-4000-8000-0000003310d1', 1, 'Plan A1', 9, true, now(), 'forged');
insert into public.bgb_plans (plan_id, team_index, name)
values ('00000000-0000-4000-8000-0000003310d2', 1, 'Plan A2');
insert into public.bgb_plans (plan_id, team_index, name)
values ('00000000-0000-4000-8000-0000003310d3', 2, 'Plan B1');
reset role;

select is((select version from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  1, 'an insert cannot start a plan at a later version');
select is((select is_live from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  false, 'nor create it live');
select is((select deleted_at from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  null, 'nor already deleted');
select is((select edited_by_name from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  'bgb officer', 'nor put somebody else''s name on it');
select is((select alliance_id from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  '00000000-0000-4000-8000-0000003310a1'::uuid, 'a new plan belongs to the alliance being viewed');

-- ---------------------------------------------------------------------------
-- Saving: starters of this team, from the NEWEST reading only.

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');

select lives_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 1, 'Plan A1 final', 'note',
       '[{"objective_key":"mil-a","player_id":"00000000-0000-4000-8000-0000003310b1","role":"hold","ordinal":1},
         {"objective_key":"factory","player_id":"00000000-0000-4000-8000-0000003310b2","role":"","ordinal":2}]'::jsonb) $$,
  'an officer saves a plan with two starters');
reset role;
select is((select version from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  2, 'a save moves the version');
select is((select name from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  'Plan A1 final', 'and the name');
select is((select count(*)::int from public.bgb_plan_assignments
            where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  2, 'and the people are stored, one row per person');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 1, null, null, '[]'::jsonb) $$,
  'PT409', null, 'a stale save is refused');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 2, null, null,
       '[{"objective_key":"roam","player_id":"00000000-0000-4000-8000-0000003310b3","role":"","ordinal":0}]'::jsonb) $$,
  '22023', null, 'a substitute in the newest reading cannot be placed, though an older reading had them as a starter');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 2, null, null,
       '[{"objective_key":"roam","player_id":"00000000-0000-4000-8000-0000003310b4","role":"","ordinal":0}]'::jsonb) $$,
  '22023', null, 'a starter of the other team cannot be placed in this one');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 2, null, null,
       '[{"objective_key":"roam","player_id":"00000000-0000-4000-8000-0000003310b1","role":"","ordinal":0},
         {"objective_key":"mil-b","player_id":"00000000-0000-4000-8000-0000003310b1","role":"","ordinal":1}]'::jsonb) $$,
  '22023', null, 'one person twice in one save is refused');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 2, null, null,
       '[{"objective_key":"the-moon","player_id":"00000000-0000-4000-8000-0000003310b1","role":"","ordinal":0}]'::jsonb) $$,
  '23514', null, 'an objective that is not on the battlefield is refused');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 2, '   ', null, '[]'::jsonb) $$,
  '22023', null, 'a plan needs a name');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 2, null, null, null) $$,
  '22023', null, 'the people must be sent');
reset role;
select is((select count(*)::int from public.bgb_plan_assignments
            where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  2, 'every refusal left the saved people untouched');
select is((select version from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  2, 'and the version');

-- ---------------------------------------------------------------------------
-- A member reads but cannot write, by any door.

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c2');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d1', 2, null, null, '[]'::jsonb) $$,
  '42501', null, 'a member cannot save a plan');
select throws_ok(
  $$ select public.make_bgb_plan_live('00000000-0000-4000-8000-0000003310d1') $$,
  '42501', null, 'nor make one live');
select throws_ok(
  $$ select public.delete_bgb_plan('00000000-0000-4000-8000-0000003310d1') $$,
  '42501', null, 'nor delete one');
select throws_ok(
  $$ select public.restore_bgb_plan('00000000-0000-4000-8000-0000003310d1') $$,
  '42501', null, 'nor restore one');
select throws_ok(
  $$ update public.bgb_plans set name = 'mine' where plan_id = '00000000-0000-4000-8000-0000003310d1' $$,
  '42501', null, 'nor update the table directly');
select throws_ok(
  $$ insert into public.bgb_plan_assignments (plan_id, objective_key, player_id)
     values ('00000000-0000-4000-8000-0000003310d1', 'roam', '00000000-0000-4000-8000-0000003310b4') $$,
  '42501', null, 'nor write assignments directly');
select is((select count(*)::int from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  1, 'a member reads the plan');
select is((select count(*)::int from public.bgb_plan_assignments
            where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  2, 'and its people');
reset role;

select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');
set local role authenticated;
select throws_ok(
  $$ insert into public.bgb_plan_assignments (plan_id, objective_key, player_id)
     values ('00000000-0000-4000-8000-0000003310d1', 'roam', '00000000-0000-4000-8000-0000003310b4') $$,
  '42501', null, 'not even an officer writes assignments around the version check');
reset role;

select is(has_function_privilege('anon', 'public.save_bgb_plan(uuid, integer, text, text, jsonb)', 'execute'),
  false, 'anon cannot save a plan');
select is(has_function_privilege('anon', 'public.make_bgb_plan_live(uuid)', 'execute'),
  false, 'anon cannot make one live');

-- ---------------------------------------------------------------------------
-- One live plan per team.

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');
select public.make_bgb_plan_live('00000000-0000-4000-8000-0000003310d1');
select public.make_bgb_plan_live('00000000-0000-4000-8000-0000003310d3');
reset role;
select is((select is_live from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  true, 'a plan can be made live');
select is((select is_live from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d3'),
  true, 'and so can a plan of the other team, at the same time');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');
select public.make_bgb_plan_live('00000000-0000-4000-8000-0000003310d2');
reset role;
select is((select is_live from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d1'),
  false, 'making another draft live retires the previous live plan of that team');
select is((select count(*)::int from public.bgb_plans where team_index = 1 and is_live
             and plan_id in ('00000000-0000-4000-8000-0000003310d1', '00000000-0000-4000-8000-0000003310d2')),
  1, 'so a team has exactly one live plan');
select is((select version from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d2'),
  1, 'making a plan live is not an edit');

-- ---------------------------------------------------------------------------
-- Delete keeps the row; members never see it; restore comes back not live.

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');
select public.delete_bgb_plan('00000000-0000-4000-8000-0000003310d2');
reset role;
select isnt((select deleted_at from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d2'),
  null, 'delete marks the plan deleted instead of removing it');
select is((select is_live from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d2'),
  false, 'and a deleted plan is not live');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c2');
select is((select count(*)::int from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d2'),
  0, 'a member does not see a deleted plan');
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');
select is((select count(*)::int from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d2'),
  1, 'an officer does, to restore it');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d2', 1, null, null, '[]'::jsonb) $$,
  'P0002', null, 'a deleted plan cannot be saved');
select public.restore_bgb_plan('00000000-0000-4000-8000-0000003310d2');
reset role;
select is((select deleted_at from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d2'),
  null, 'restore brings it back');
select is((select is_live from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d2'),
  false, 'and not live, since another plan may have been made live meanwhile');

select is((select internal.purge_deleted_bgb_plans()), 0, 'nothing deleted recently is purged');

-- ---------------------------------------------------------------------------
-- Another alliance's plan is refused before its version can answer, and
-- invisible.

insert into public.bgb_plans (plan_id, team_index, name, alliance_id)
values ('00000000-0000-4000-8000-0000003310d9', 1, 'Theirs', '00000000-0000-4000-8000-0000003310a2');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003310c3');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003310d9', 1, null, null, '[]'::jsonb) $$,
  '42501', null, 'another alliance''s plan is refused even with its right version');
select throws_ok(
  $$ select public.delete_bgb_plan('00000000-0000-4000-8000-0000003310d9') $$,
  '42501', null, 'nor can it be deleted');
select is((select count(*)::int from public.bgb_plans where plan_id = '00000000-0000-4000-8000-0000003310d9'),
  0, 'and it is not visible');
reset role;

select * from finish();
rollback;
