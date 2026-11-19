-- 0334: the map says which alliance a base is in (map_atlas), a map sighting
-- records a server move, and a mission is on the map it stands on.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

select has_column('public', 'world_city_snapshots', 'in_alliance', 'in_alliance exists');
select has_column('public', 'world_city_snapshots', 'alliance_id', 'alliance_id exists');
select has_column('public', 'world_city_snapshots', 'alliance_code', 'alliance_code exists');
select has_trigger('public', 'world_city_snapshots', 'record_server_moves',
  'world_city_snapshots records moves');
select ok(not has_function_privilege('authenticated',
  'internal.world_city_snapshots_record_server_moves()', 'execute'),
  'nobody in the API can call the trigger function');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000334f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'map-alliance@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000334f1', 'member', 'map alliance');
insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000334c1', 'map-alliance-test');

-- Two alliances on 566. The second's row still has the code it was first seen
-- with; the map has since printed a new one.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code) values
  ('00000000-0000-4000-8000-0000000334a1', 566, 'ext-334-one', 'First', 'ONE'),
  ('00000000-0000-4000-8000-0000000334a2', 566, 'ext-334-two', null, 'OLD'),
  ('00000000-0000-4000-8000-0000000334a3', 566, 'ext-334-gone', 'Left Behind', 'GONE');

-- Every uid ends in 566, the server each account was made on, except Arrival's.
insert into public.players (player_id, server_id, game_uid, current_name, power, current_alliance_id) values
  -- the map says ONE; the players row knows of no alliance at all
  ('00000000-0000-4000-8000-0000000334b1', 566, 9733400000000566, 'MapOnly', 10, null),
  -- the map says no alliance; the players row still names the one they left
  ('00000000-0000-4000-8000-0000000334b2', 566, 9733401000000566, 'Solo', 20,
   '00000000-0000-4000-8000-0000000334a3'),
  -- a row from before 1.7.0: the last-known alliance is all there is
  ('00000000-0000-4000-8000-0000000334b3', 566, 9733402000000566, 'Older', 30,
   '00000000-0000-4000-8000-0000000334a3'),
  -- the map says TWO, printing its new tag
  ('00000000-0000-4000-8000-0000000334b4', 566, 9733403000000566, 'Renamed', 40, null),
  -- made on 580, now on 566's map
  ('00000000-0000-4000-8000-0000000334b5', 580, 9733404000000580, 'Arrival', 50, null);

-- A city row as parser 1.7.0 writes it. p_in null: a row from before it.
create function pg_temp.city(p_player uuid, p_map int, p_at timestamptz, p_in boolean,
                             p_alliance uuid, p_code text, p_key text)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, map_server_id, player_id, game_uid,
     point_id, x, y, name, hq_level, in_alliance, alliance_id, alliance_code)
  select gen_random_uuid(), 'world.get.new', 't', 'mna:' || p_key, p_at,
         '00000000-0000-4000-8000-0000000334c1', 580, (p.game_uid % 1000000)::int, p_map,
         p.player_id, p.game_uid, 9001, 0, 9, p.current_name, 25, p_in, p_alliance, p_code
    from public.players p where p.player_id = p_player;
$$;

select pg_temp.city('00000000-0000-4000-8000-0000000334b1', 566, now(), true,
  '00000000-0000-4000-8000-0000000334a1', 'ONE', 'b1');
select pg_temp.city('00000000-0000-4000-8000-0000000334b2', 566, now(), false, null, null, 'b2');
select pg_temp.city('00000000-0000-4000-8000-0000000334b3', 566, now(), null, null, null, 'b3');
select pg_temp.city('00000000-0000-4000-8000-0000000334b4', 566, now(), true,
  '00000000-0000-4000-8000-0000000334a2', 'NEW', 'b4');

-- Arrival: seen on 580's map, then on 566's, then on 566's again.
select pg_temp.city('00000000-0000-4000-8000-0000000334b5', 580, '2027-06-01T00:00:00Z', false, null, null, 'b5-1');
select pg_temp.city('00000000-0000-4000-8000-0000000334b5', 566, '2027-06-03T00:00:00Z', false, null, null, 'b5-2');
select pg_temp.city('00000000-0000-4000-8000-0000000334b5', 566, '2027-06-04T00:00:00Z', false, null, null, 'b5-3');

-- ---------------------------------------------------------------------------
-- The move log, as the trigger wrote it.

select is((select count(*)::int from public.player_server_moves
            where player_id = '00000000-0000-4000-8000-0000000334b5'), 1,
  'a base on another server''s map is one move, however often it is seen there');
select is((select array[from_server_id, to_server_id] from public.player_server_moves
            where player_id = '00000000-0000-4000-8000-0000000334b5'), array[580, 566],
  'from the server it was made on to the map it stands on');
select is((select seen_at from public.player_server_moves
            where player_id = '00000000-0000-4000-8000-0000000334b5'), '2027-06-03T00:00:00Z'::timestamptz,
  'first seen there at the first sighting on the new map');
select is((select last_seen_from_at from public.player_server_moves
            where player_id = '00000000-0000-4000-8000-0000000334b5'), '2027-06-01T00:00:00Z'::timestamptz,
  'last seen before on the old server''s map');
select is((select count(*)::int from public.player_server_moves
            where player_id in ('00000000-0000-4000-8000-0000000334b1',
                                '00000000-0000-4000-8000-0000000334b2',
                                '00000000-0000-4000-8000-0000000334b4')), 0,
  'a base on the map of the server it was made on is no move');

-- ---------------------------------------------------------------------------
-- A mission filed under its owner's home server before 1.7.0 is on the map
-- its tile names; its alliance is found by id on another server.

insert into public.game_dispatch_missions
  (mission_id, color, star, duration_seconds, steal_max, orange_books)
values (9933401, 4, 2, 7200, 3, 6);
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values ('00000000-0000-4000-8000-0000000334a9', 571, 'ext-334-mission', 'Movers', 'MOV');
insert into public.dispatch_mission_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, point_id, x, y, mission_id, mission_uuid,
   owner_game_uid, alliance_external_id, started_at, ends_at, raw)
values
  (gen_random_uuid(), 'world.get.new', '1.6.0', 'mna:m-old', now(),
   '00000000-0000-4000-8000-0000000334c1', 580, 571, 393447, 446, 393, 9933401, 'm-334-old',
   9733405000000571, 'ext-334-mission', now() - interval '1 hour', now() + interval '1 hour',
   '{"2": [21], "102": [580], "103": [580]}'),
  -- a row with no tile server in raw keeps the column's
  (gen_random_uuid(), 'world.get.new', '1.7.0', 'mna:m-new', now(),
   '00000000-0000-4000-8000-0000000334c1', 580, 566, 393448, 447, 393, 9933401, 'm-334-new',
   9733405000000571, null, now() - interval '1 hour', now() + interval '1 hour', '{}');

select is((select server_id from public.dispatch_missions_live where mission_uuid = 'm-334-old'), 580,
  'a mission is on the map its tile names, not its owner''s home server');
select is((select server_id from public.dispatch_missions_live where mission_uuid = 'm-334-new'), 566,
  'a row whose raw names no server keeps its own');
select is((select alliance_abbr from public.dispatch_missions_live where mission_uuid = 'm-334-old'), 'MOV',
  'the alliance is found by its id though it is filed under another server');

-- ---------------------------------------------------------------------------
-- map_atlas, as a member.

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000334f1')::text, true);
set local role authenticated;

create function pg_temp.code_of(p_name text) returns text language sql as $$
  select case when (e ->> 5)::int < 0 then null
              else a -> 'alliances' -> (e ->> 5)::int ->> 'code' end
    from public.map_atlas(566) a, jsonb_array_elements(a -> 'bases') e
   where e ->> 7 = p_name;
$$;

select is((select count(*)::int from public.map_atlas(566) a, jsonb_array_elements(a -> 'bases') e
            where e ->> 7 in ('MapOnly', 'Solo', 'Older', 'Renamed', 'Arrival')), 5,
  'every base is on the 566 map');
select is(pg_temp.code_of('MapOnly'), 'ONE',
  'a base is in the alliance the map drew it in, though nothing else knows it');
select is(pg_temp.code_of('Solo'), null,
  'the map drawing it in no alliance outranks the last-known one');
select is(pg_temp.code_of('Older'), 'GONE',
  'a row from before the map looked keeps the last-known alliance');
select is(pg_temp.code_of('Renamed'), 'NEW',
  'the tag is the one the map printed, not the alliance row''s first one');
select is(pg_temp.code_of('Arrival'), null,
  'the arrival is on its new map, in no alliance');
select is((select jsonb_array_length(a -> 'alliances') from public.map_atlas(566) a), 3,
  'three alliances are ranked: ONE, NEW and GONE');

select * from finish();
rollback;
