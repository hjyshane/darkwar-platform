-- 0246: seen-but-unnamed building types come with the client's own name, and
-- one call names every one that has it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gn-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gn-admin@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f301', 'member', 'gn member'),
  ('00000000-0000-4000-8000-00000000f303', 'admin', 'gn admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- The client names 930000 and 930001 (at every level, once); 930002 it does not.
insert into public.game_upgrade_steps (kind, subject_id, level, name) values
  ('building', '930000', 1, 'Test Dock'),
  ('building', '930000', 2, 'Test Dock'),
  ('building', '930001', 1, 'Test Mill');

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level)
values ('00000000-0000-4000-8000-00000000f101', 580, 9410000000000201, 'Gamma', 90, 30);
insert into public.player_season_buildings_current
  (player_id, game_uid, server_id, levels, oldest_seen, newest_seen)
values ('00000000-0000-4000-8000-00000000f101', 9410000000000201, 580,
        '{"930000": 3, "930001": 2, "930002": 1}'::jsonb, now(), now());

select pg_temp.act_as('00000000-0000-4000-8000-00000000f301');
set local role authenticated;
select is(
  (select array_agg(game_name order by building_type_id) from public.season_unnamed_buildings()),
  array['Test Dock', 'Test Mill', null],
  'each unnamed type comes with the client''s name, null where it has none');
select throws_ok($$select public.name_unnamed_season_buildings(3)$$, '42501', null,
  'a member cannot name buildings');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f303');
set local role authenticated;
select throws_ok($$select public.name_unnamed_season_buildings(99)$$, '22023', null,
  'there has to be a season');
select is(public.name_unnamed_season_buildings(3), 2, 'two types had a name, so two are named');
select is((select name from public.season_buildings where season_id = 3 and building_type_id = 930000),
  'Test Dock', 'under the client''s name');
select ok((select sort_order from public.season_buildings where season_id = 3 and building_type_id = 930000)
          > (select sort_order from public.season_buildings where season_id = 3 and building_type_id = 862000),
  'after the buildings the season already had');
select is(
  (select array_agg(building_type_id) from public.season_unnamed_buildings()),
  array[930002], 'the one the client has no name for is left for a person');
select is(public.name_unnamed_season_buildings(3), 0, 'a second call names nothing');

reset role;
select ok(not has_function_privilege('anon', 'public.name_unnamed_season_buildings(int)', 'execute'),
  'anon cannot call it');

select * from finish();
rollback;
