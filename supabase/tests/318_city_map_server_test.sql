-- 0318: a base follows the map it was seen on; a migration moves it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000fa01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'atlas-move@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000fa01', 'member', 'atlas move');
insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000fa11', 'atlas-move-test');

-- Home servers are 577 (Came: migrated INTO 580), 580 (Went: migrated OUT to 581),
-- 580 (Home: never moved, an old row with no map_server_id).
create function pg_temp.city(p_uid bigint, p_home int, p_map int, p_name text, p_x int, p_age text)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, map_server_id, game_uid,
     point_id, x, y, name, hq_level)
  values (gen_random_uuid(), 'world.get.new', 't', 'mv:' || p_name || p_age, now() - p_age::interval,
          '00000000-0000-4000-8000-00000000fa11', 580, p_home, p_map, p_uid,
          p_x + 1, p_x, 7, p_name, 30);
$$;

-- Came: seen on 577 a week ago, on 580 now.
select pg_temp.city(9730000000000577, 577, 577, 'Came', 1, '7 days');
select pg_temp.city(9730000000000577, 577, 580, 'Came', 1, '1 hour');
-- Went: seen on 580 (old row, no map_server_id) a week ago, on 581 now.
select pg_temp.city(9730000000000580, 580, null, 'Went', 2, '7 days');
select pg_temp.city(9730000000000580, 580, 581, 'Went', 2, '1 hour');
-- Home: an old row only.
select pg_temp.city(9730000000000581, 580, null, 'Home', 3, '2 days');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000fa01')::text, true);
set local role authenticated;

create function pg_temp.names(p int) returns text[] language sql as $$
  select coalesce(array_agg(e ->> 7 order by e ->> 7), '{}')
    from public.map_atlas(p) a, jsonb_array_elements(a -> 'bases') e;
$$;

select is(pg_temp.names(580), array['Came', 'Home'],
  '580 shows who moved in and who stayed, not who moved out');
select is(pg_temp.names(581), array['Went'], 'the new server shows the one who moved there');
select is(pg_temp.names(577), '{}'::text[], 'the old server no longer shows the one who left');
select ok(not (pg_temp.names(580) @> array['Went']), 'a base seen on another map since is gone');
select is((select count(*)::int from public.world_city_snapshots
            where map_server_id is null and name = 'Home'), 1,
  'old rows keep a null map and are read as their home server');

select * from finish();
rollback;
