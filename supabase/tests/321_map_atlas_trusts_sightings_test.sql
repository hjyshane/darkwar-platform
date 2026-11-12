-- 0321: a sighting here outranks the players table; a player known to live on another server is not on this map.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000fa01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'atlas-move@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000fa01', 'member', 'atlas move');
insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000fa11', 'atlas-move-test');

insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-00000000fb01', 580, 9740000000000580, 'Stayed', 10),
  ('00000000-0000-4000-8000-00000000fb02', 581, 9740000000000581, 'MovedOut', 20);

create function pg_temp.city(p_uid bigint, p_player uuid, p_name text, p_x int)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     point_id, x, y, name, hq_level)
  values (gen_random_uuid(), 'world.get.new', 't', 'mo:' || p_name, now(),
          '00000000-0000-4000-8000-00000000fa11', 580, 580, p_player, p_uid,
          p_x + 1, p_x, 9, p_name, 30);
$$;
-- both have an old row on the 580 map; the players table says one now lives on 581
select pg_temp.city(9740000000000580, '00000000-0000-4000-8000-00000000fb01', 'Stayed', 1);
select pg_temp.city(9740000000000581, '00000000-0000-4000-8000-00000000fb02', 'MovedOut', 2);
-- MovedIn: players says 577, but a NEW sighting on the 580 map exists
insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-00000000fb03', 577, 9740000000000577, 'MovedIn', 30);
insert into public.world_city_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, map_server_id, player_id, game_uid,
   point_id, x, y, name, hq_level)
values (gen_random_uuid(), 'world.get.new', 't', 'mo:MovedIn', now(),
        '00000000-0000-4000-8000-00000000fa11', 580, 577, 580,
        '00000000-0000-4000-8000-00000000fb03', 9740000000000577, 5, 4, 9, 'MovedIn', 30);
-- and a base whose player row does not exist stays
select pg_temp.city(9740000000000582, null, 'Unknown', 3);

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000fa01')::text, true);
set local role authenticated;

create function pg_temp.names(p int) returns text[] language sql as $$
  select coalesce(array_agg(e ->> 7 order by e ->> 7), '{}')
    from public.map_atlas(p) a, jsonb_array_elements(a -> 'bases') e;
$$;

select is(pg_temp.names(580), array['MovedIn', 'Stayed', 'Unknown'],
  'a player known on another server is off the 580 map; an unknown one stays, and one seen here is kept');
select is(pg_temp.names(581), '{}'::text[], 'and no row of theirs was written for 581');

select * from finish();
rollback;
