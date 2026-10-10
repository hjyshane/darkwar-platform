-- 0270: world_cities_in_box returns each base's NEWEST sighting when it is inside
-- the rectangle, and drops a base whose newest sighting has left it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f701', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'box-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f701', 'member', 'box member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000f711', 'box-test');

create function pg_temp.city(p_server int, p_uid bigint, p_name text, p_x int, p_y int,
                             p_age interval)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     point_id, x, y, name, hq_level)
  values (gen_random_uuid(), 'world.get.new', 't',
          'box:' || p_uid::text || ':' || p_age::text || ':' || p_x::text,
          now() - p_age,
          '00000000-0000-4000-8000-00000000f711', p_server, p_server, null, p_uid,
          p_y * 1000 + p_x + 1, p_x, p_y, p_name, 30);
$$;

-- STAYS: seen twice at the same spot; the newer sighting is the answer.
select pg_temp.city(580, 9730000000000001, 'StaysOld', 10, 10, interval '2 days');
select pg_temp.city(580, 9730000000000001, 'StaysNew', 10, 10, interval '1 hour');
-- LEFT: was in the box, newest sighting is far outside it.
select pg_temp.city(580, 9730000000000002, 'LeftIn', 12, 12, interval '2 days');
select pg_temp.city(580, 9730000000000002, 'LeftOut', 500, 500, interval '1 hour');
-- ARRIVED: was outside, newest sighting is inside.
select pg_temp.city(580, 9730000000000003, 'ArrivedOut', 700, 700, interval '2 days');
select pg_temp.city(580, 9730000000000003, 'ArrivedIn', 15, 15, interval '1 hour');
-- OTHER: another server, same coordinates.
select pg_temp.city(581, 9730000000000004, 'OtherServer', 11, 11, interval '1 hour');
-- FAR: only ever outside.
select pg_temp.city(580, 9730000000000005, 'Far', 900, 900, interval '1 hour');

select pg_temp.act_as('00000000-0000-4000-8000-00000000f701');
set local role authenticated;

select is((select count(*)::int from public.world_cities_in_box(580, 0, 20, 0, 20)), 2,
  'two bases have their newest sighting inside the box');
select is((select name from public.world_cities_in_box(580, 0, 20, 0, 20) where game_uid = 9730000000000001),
  'StaysNew', 'a base seen twice is returned once, as its newest sighting');
select is((select count(*)::int from public.world_cities_in_box(580, 0, 20, 0, 20)
            where game_uid = 9730000000000002), 0,
  'a base whose newest sighting left the box is not returned');
select is((select name from public.world_cities_in_box(580, 0, 20, 0, 20) where game_uid = 9730000000000003),
  'ArrivedIn', 'a base that arrived is returned at its newest spot');
select is((select count(*)::int from public.world_cities_in_box(580, 20, 0, 20, 0)), 2,
  'the bounds may be given in either order');
select is((select count(*)::int from public.world_cities_in_box(581, 0, 20, 0, 20)), 1,
  'another server''s bases are its own');
select is((select array_agg(game_uid order by x, y) from public.world_cities_in_box(580, 0, 20, 0, 20)),
  array[9730000000000001, 9730000000000003]::bigint[], 'ordered by x then y');

select * from finish();
