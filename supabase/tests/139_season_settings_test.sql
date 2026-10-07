-- 0242: seasons and their buildings are data.
--
-- Refusals first (§20.2): a season or a building name written by somebody who
-- may not would rename what every alliance's board shows.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000c301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sea-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000c302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sea-officer@test.invalid'),
  ('00000000-0000-4000-8000-00000000c303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sea-admin@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000c301', 'member', 'sea member'),
  ('00000000-0000-4000-8000-00000000c302', 'officer', 'sea officer'),
  ('00000000-0000-4000-8000-00000000c303', 'admin', 'sea admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- ------------------------------------------------------------ the seed

select is((select count(*) from public.season_buildings where season_id = 3), 11::bigint,
  'Season 3 starts with the eleven buildings the code held');
select is((select name from public.season_buildings where season_id = 3 and building_type_id = 862000),
  'Thermal Lab', 'under the names the board shows');
select is(
  (select array_agg(building_type_id order by sort_order) from public.season_buildings where season_id = 3),
  array[862000, 857000, 858000, 859000, 860000, 861000, 863000, 864000, 866000, 865000, 867000],
  'in the order the alliance reads them');
select is((select count(*) from public.season_buildings where season_id = 2 and provisional), 11::bigint,
  'Season 2''s names are all marked as guesses');
select is(internal.duel_round_anchor(), timestamptz '2026-08-17 02:00:00+00',
  'the duel round anchor is still Season 3''s start');

-- ------------------------------------------------------------- refusals

select pg_temp.act_as('00000000-0000-4000-8000-00000000c301');
set local role authenticated;
select throws_ok($$select public.save_season(4, 'Season 4', now() + interval '30 days')$$,
  '42501', null, 'a member cannot add a season');
select throws_ok($$select public.save_season_building(3, 868000, 'New')$$,
  '42501', null, 'a member cannot name a building');
select throws_ok($$select public.delete_season_building(3, 867000)$$,
  '42501', null, 'a member cannot remove one');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000c302');
set local role authenticated;
select throws_ok($$select public.save_season(4, 'Season 4', now() + interval '30 days')$$,
  '42501', null, 'an officer cannot either: it is catalogue.write');

reset role;
select ok(not has_function_privilege('anon', 'public.save_season(int, text, timestamptz, timestamptz)', 'execute'),
  'anon cannot add a season');
select ok(not has_function_privilege('anon', 'public.season_unnamed_buildings()', 'execute'),
  'anon cannot list the unnamed buildings');
select is((select count(*) from public.seasons), 2::bigint, 'nothing was written');

-- ----------------------------------------------------------- the writer

select pg_temp.act_as('00000000-0000-4000-8000-00000000c303');
set local role authenticated;
select lives_ok($$select public.save_season(4, 'Season 4', now() + interval '30 days')$$,
  'an admin adds a season that has not started');
select throws_ok($$select public.save_season(0, 'x')$$, '22023', null, 'season 0 is refused');
select throws_ok($$select public.save_season(5, '  ')$$, '22023', null, 'a blank name is refused');
select throws_ok(
  $$select public.save_season(5, 'Backwards', '2026-10-10', '2026-10-01')$$,
  '22023', null, 'a season cannot end before it starts');
select throws_ok($$select public.save_season_building(99, 868000, 'Orphan')$$,
  '22023', null, 'a building needs a season that exists');
select lives_ok($$select public.save_season_building(4, 900000, 'Moon Base')$$,
  'an admin names a building');
select is((select sort_order from public.season_buildings where season_id = 4 and building_type_id = 900000),
  10, 'the first building of a season is ordered 10');

reset role;
select is(internal.duel_round_anchor(), timestamptz '2026-08-17 02:00:00+00',
  'a season that has not started does not move the anchor');
update public.seasons set starts_at = timestamptz '2026-09-28 02:00:00+00' where season_id = 4;
select is(internal.duel_round_anchor(), timestamptz '2026-09-28 02:00:00+00',
  'once it starts, rounds count from it');

-- ------------------------------------------------------- unnamed buildings

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level)
values ('00000000-0000-4000-8000-00000000c101', 580, 9410000000000101, 'Alpha', 90, 30);
insert into public.player_season_buildings_current
  (player_id, game_uid, server_id, levels, oldest_seen, newest_seen)
values ('00000000-0000-4000-8000-00000000c101', 9410000000000101, 580,
        '{"857000": 3, "910000": 2, "910001": 1}'::jsonb, now(), now());

select pg_temp.act_as('00000000-0000-4000-8000-00000000c301');
set local role authenticated;
select is((select array_agg(building_type_id order by building_type_id) from public.season_unnamed_buildings()),
  array[910000, 910001], 'seen but named nowhere: the two new ids, not the named one');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000c303');
set local role authenticated;
select public.save_season_building(4, 910000, 'Sky Dock');
select is((select array_agg(building_type_id) from public.season_unnamed_buildings()),
  array[910001], 'naming one takes it off the list');

select * from finish();
rollback;
