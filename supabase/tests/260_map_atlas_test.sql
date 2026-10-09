-- 0260: a server's bases and alliances in one jsonb; members read it, strangers get nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000e501', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'atlas-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000e502', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'atlas-stranger@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e501', 'member', 'atlas member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000e511', 'atlas-test');
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code) values
  ('00000000-0000-4000-8000-00000000e521', 580, 'atlas-big', 'Big', 'BIG'),
  ('00000000-0000-4000-8000-00000000e522', 580, 'atlas-small', 'Small', 'SML');
insert into public.players (player_id, server_id, game_uid, current_name, power, current_alliance_id) values
  ('00000000-0000-4000-8000-00000000e531', 580, 9710000000000580, 'A1', 100, '00000000-0000-4000-8000-00000000e521'),
  ('00000000-0000-4000-8000-00000000e532', 580, 9710000000000581, 'A2', 300, '00000000-0000-4000-8000-00000000e521'),
  ('00000000-0000-4000-8000-00000000e533', 580, 9710000000000582, 'B1', 50, '00000000-0000-4000-8000-00000000e522'),
  ('00000000-0000-4000-8000-00000000e534', 580, 9710000000000583, 'Loner', 10, null);

create function pg_temp.city(p_uid bigint, p_player uuid, p_name text, p_x int, p_y int, p_server int)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     point_id, x, y, name, hq_level)
  values (gen_random_uuid(), 'world.get.new', 't', 'atlas:' || p_uid::text || p_server::text, now(),
          '00000000-0000-4000-8000-00000000e511', 580, p_server, p_player, p_uid,
          p_y * 1000 + p_x + 1, p_x, p_y, p_name, 30);
$$;

select pg_temp.city(9710000000000580, '00000000-0000-4000-8000-00000000e531', 'A1', 10, 20, 580);
select pg_temp.city(9710000000000581, '00000000-0000-4000-8000-00000000e532', 'A2', 11, 21, 580);
select pg_temp.city(9710000000000582, '00000000-0000-4000-8000-00000000e533', 'B1', 12, 22, 580);
select pg_temp.city(9710000000000583, '00000000-0000-4000-8000-00000000e534', 'Loner', 13, 23, 580);
-- On another server: must not appear.
select pg_temp.city(9710000000000584, null, 'Elsewhere', 1, 1, 581);

select pg_temp.act_as('00000000-0000-4000-8000-00000000e501');
set local role authenticated;

select is(jsonb_array_length(public.map_atlas(580) -> 'bases'), 4,
  'every swept base of the server, none from another');
select is(jsonb_array_length(public.map_atlas(580) -> 'alliances'), 2, 'two alliances are known');
select is(public.map_atlas(580) -> 'alliances' -> 0 ->> 'code', 'BIG',
  'the one with most bases comes first');
select is((public.map_atlas(580) -> 'alliances' -> 0 ->> 'bases')::int, 2, 'with its base count');
select is((public.map_atlas(580) -> 'alliances' -> 0 ->> 'power')::int, 400,
  'and the power of those bases');
select is((select (e -> 5)::int from jsonb_array_elements(public.map_atlas(580) -> 'bases') e
            where e ->> 7 = 'Loner'), -1,
  'a base with no known alliance is -1');
select is(public.map_atlas(999) -> 'bases', '[]'::jsonb,
  'a server nobody swept is an empty list, not an error');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e502');
set local role authenticated;
select is(jsonb_array_length(public.map_atlas(580) -> 'bases'), 0,
  'a user with no role gets no bases');

reset role;
select * from finish();
rollback;
