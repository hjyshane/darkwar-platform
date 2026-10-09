-- 0266: the map counts current members: a player the newest usable roster does not
-- list has left, and an unrostered or half-read alliance is left as it was.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f601', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'atlas-members@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f601', 'member', 'atlas members');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000f611', 'atlas-members-test');

-- ROST: a complete roster. HALF: a roster 40% read. NONE: never rostered.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code, member_count) values
  ('00000000-0000-4000-8000-00000000f621', 580, 'am-rost', 'Rostered', 'ROST', 2),
  ('00000000-0000-4000-8000-00000000f622', 580, 'am-half', 'Half', 'HALF', 5),
  ('00000000-0000-4000-8000-00000000f623', 580, 'am-none', 'None', 'NONE', 3);

insert into public.players (player_id, server_id, game_uid, current_name, power, current_alliance_id) values
  ('00000000-0000-4000-8000-00000000f631', 580, 9720000000000001, 'Stays1', 10, '00000000-0000-4000-8000-00000000f621'),
  ('00000000-0000-4000-8000-00000000f632', 580, 9720000000000002, 'Stays2', 20, '00000000-0000-4000-8000-00000000f621'),
  ('00000000-0000-4000-8000-00000000f633', 580, 9720000000000003, 'Left',   30, '00000000-0000-4000-8000-00000000f621'),
  ('00000000-0000-4000-8000-00000000f634', 580, 9720000000000004, 'HalfIn', 40, '00000000-0000-4000-8000-00000000f622'),
  ('00000000-0000-4000-8000-00000000f635', 580, 9720000000000005, 'HalfOut', 50, '00000000-0000-4000-8000-00000000f622'),
  ('00000000-0000-4000-8000-00000000f636', 580, 9720000000000006, 'NoRoster', 60, '00000000-0000-4000-8000-00000000f623');

create function pg_temp.roster(p_alliance uuid, p_player uuid, p_uid bigint, p_key text)
returns void language sql as $$
  insert into public.alliance_member_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, alliance_id, server_id, player_id, game_uid, name)
  values (gen_random_uuid(), 'al.rank', 't', 'am:' || p_key, now(),
          '00000000-0000-4000-8000-00000000f611', 580, p_alliance, 580, p_player, p_uid, p_key);
$$;

-- ROST's newest roster lists two of the three who name it: complete (2 of 2).
select pg_temp.roster('00000000-0000-4000-8000-00000000f621', '00000000-0000-4000-8000-00000000f631', 9720000000000001, 'r1');
select pg_temp.roster('00000000-0000-4000-8000-00000000f621', '00000000-0000-4000-8000-00000000f632', 9720000000000002, 'r2');
-- HALF's roster has 2 of 5: not usable, so nobody is judged to have left.
select pg_temp.roster('00000000-0000-4000-8000-00000000f622', '00000000-0000-4000-8000-00000000f634', 9720000000000004, 'h1');
select pg_temp.roster('00000000-0000-4000-8000-00000000f622', null, 9720000000000099, 'h2');

create function pg_temp.city(p_uid bigint, p_player uuid, p_name text, p_x int)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     point_id, x, y, name, hq_level)
  values (gen_random_uuid(), 'world.get.new', 't', 'amc:' || p_uid::text, now(),
          '00000000-0000-4000-8000-00000000f611', 580, 580, p_player, p_uid,
          p_x + 1, p_x, 5, p_name, 30);
$$;
select pg_temp.city(9720000000000001, '00000000-0000-4000-8000-00000000f631', 'Stays1', 1);
select pg_temp.city(9720000000000002, '00000000-0000-4000-8000-00000000f632', 'Stays2', 2);
select pg_temp.city(9720000000000003, '00000000-0000-4000-8000-00000000f633', 'Left', 3);
select pg_temp.city(9720000000000004, '00000000-0000-4000-8000-00000000f634', 'HalfIn', 4);
select pg_temp.city(9720000000000005, '00000000-0000-4000-8000-00000000f635', 'HalfOut', 5);
select pg_temp.city(9720000000000006, '00000000-0000-4000-8000-00000000f636', 'NoRoster', 6);

select pg_temp.act_as('00000000-0000-4000-8000-00000000f601');
set local role authenticated;

create function pg_temp.alliance_of(p_name text) returns text language sql as $$
  select a -> 'alliances' -> (e ->> 5)::int ->> 'code'
    from public.map_atlas(580) a, jsonb_array_elements(a -> 'bases') e
   where e ->> 7 = p_name and (e ->> 5)::int >= 0;
$$;

select is(pg_temp.alliance_of('Stays1'), 'ROST', 'a player the roster lists is a member');
select is(pg_temp.alliance_of('Left'), null, 'one the complete roster does not list has left');
select is(pg_temp.alliance_of('HalfOut'), 'HALF',
  'a half-read roster does not send anyone away');
select is(pg_temp.alliance_of('NoRoster'), 'NONE', 'an alliance never rostered is left as it was');
select is((select (e ->> 'bases')::int from public.map_atlas(580) a,
                   jsonb_array_elements(a -> 'alliances') e where e ->> 'code' = 'ROST'), 2,
  'and the alliance ranking counts the two who are in it, not the three who named it');
select is((select e -> 5 from public.map_atlas(580) a, jsonb_array_elements(a -> 'bases') e
            where e ->> 7 = 'Left'), '-1'::jsonb, 'the one who left is -1 on the map');
select is((select count(*)::int from public.map_atlas(580) a, jsonb_array_elements(a -> 'bases') e
            where (e ->> 5)::int >= 0), 5, 'five of six bases still have an alliance');

select * from finish();
rollback;
