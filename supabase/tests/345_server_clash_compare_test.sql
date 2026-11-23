-- 0345: server_clash_compare - two servers through their top 3 alliances and the
-- members seen on the map; who moved is a separate figure, and who was not seen
-- (or has no power reading) is counted as needing a scan. An admin reads it; an officer, a member, community and anon
-- are refused (raised, not an empty document that would read as two dead servers).
--
-- Servers 580 and 584. 580: alliance AA (strong), members
--   p1  power 100 -> 150 two days apart                      active (grew)
--   p2  power 200 -> 200                                      seen, did not move
--   p3  power 300 -> 320 ten days ago                         counted (seen), moved only in a 30-day window
--   alliance AA says 30 members: 27 were never seen
-- 584: alliance BB, members
--   q1  no power reading, base seen at two places             active (moved)
--   q2  no power reading, a truck of theirs seen              active (truck)
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000003450101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sc-admin@test.invalid'),
  ('00000000-0000-4000-8000-000003450102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sc-officer@test.invalid'),
  ('00000000-0000-4000-8000-000003450103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sc-member@test.invalid'),
  ('00000000-0000-4000-8000-000003450104', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sc-community@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-000003450101', 'admin'),
  ('00000000-0000-4000-8000-000003450102', 'officer'),
  ('00000000-0000-4000-8000-000003450103', 'member'),
  ('00000000-0000-4000-8000-000003450104', 'community')
on conflict (user_id) do update set role = excluded.role;

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000e451', 'server-clash-test');

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code) values
  ('00000000-0000-4000-8000-00000000ea51', 580, 'sc-aa', 'Alpha', 'AA'),
  ('00000000-0000-4000-8000-00000000ea52', 584, 'sc-bb', 'Bravo', 'BB');

insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-00000000e501', 580, 9451000001000580, 'p1'),
  ('00000000-0000-4000-8000-00000000e502', 580, 9451000002000580, 'p2'),
  ('00000000-0000-4000-8000-00000000e503', 580, 9451000003000580, 'p3'),
  ('00000000-0000-4000-8000-00000000e504', 584, 9451000004000584, 'q1'),
  ('00000000-0000-4000-8000-00000000e505', 584, 9451000005000584, 'q2');

insert into public.alliance_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, alliance_id, external_id, name, code,
   power, member_count)
values
  (gen_random_uuid(), 'alliance.rank', 't', 'sc:al:aa', now() - interval '1 hour',
   '00000000-0000-4000-8000-00000000e451', 580, 580,
   '00000000-0000-4000-8000-00000000ea51', 'sc-aa', 'Alpha', 'AA', 900, 30),
  (gen_random_uuid(), 'alliance.rank', 't', 'sc:al:bb', now() - interval '1 hour',
   '00000000-0000-4000-8000-00000000e451', 580, 584,
   '00000000-0000-4000-8000-00000000ea52', 'sc-bb', 'Bravo', 'BB', 500, 25);

create function pg_temp.city(key text, who uuid, uid bigint, srv int, ali uuid, nm text,
                             pt bigint, ago interval)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     point_id, x, y, name, hq_level, alliance_id, in_alliance)
  values (gen_random_uuid(), 'world.get.new', 't', key, now() - ago,
          '00000000-0000-4000-8000-00000000e451', 580, srv, who, uid,
          pt, pt / 1000, pt % 1000, nm, 30, ali, true);
$$;

-- Every member is seen in his alliance on the map.
select pg_temp.city('sc:c:p1', '00000000-0000-4000-8000-00000000e501', 9451000001000580, 580,
  '00000000-0000-4000-8000-00000000ea51', 'p1', 100100, interval '1 day');
select pg_temp.city('sc:c:p2', '00000000-0000-4000-8000-00000000e502', 9451000002000580, 580,
  '00000000-0000-4000-8000-00000000ea51', 'p2', 100101, interval '1 day');
select pg_temp.city('sc:c:p3', '00000000-0000-4000-8000-00000000e503', 9451000003000580, 580,
  '00000000-0000-4000-8000-00000000ea51', 'p3', 100102, interval '5 days');
-- q1 moved: the same base at two points.
select pg_temp.city('sc:c:q1a', '00000000-0000-4000-8000-00000000e504', 9451000004000584, 584,
  '00000000-0000-4000-8000-00000000ea52', 'q1', 200200, interval '3 days');
select pg_temp.city('sc:c:q1b', '00000000-0000-4000-8000-00000000e504', 9451000004000584, 584,
  '00000000-0000-4000-8000-00000000ea52', 'q1', 210210, interval '1 day');
select pg_temp.city('sc:c:q2', '00000000-0000-4000-8000-00000000e505', 9451000005000584, 584,
  '00000000-0000-4000-8000-00000000ea52', 'q2', 200201, interval '1 day');

create function pg_temp.pwr(key text, who uuid, uid bigint, srv int, pw bigint, ago interval)
returns void language sql as $$
  insert into public.player_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power)
  values (gen_random_uuid(), 'server.rank', 't', key, now() - ago,
          '00000000-0000-4000-8000-00000000e451', 580, who, srv, uid, 'n' || uid, pw);
$$;

select pg_temp.pwr('sc:p:p1a', '00000000-0000-4000-8000-00000000e501', 9451000001000580, 580, 100, interval '2 days');
select pg_temp.pwr('sc:p:p1b', '00000000-0000-4000-8000-00000000e501', 9451000001000580, 580, 150, interval '1 hour');
select pg_temp.pwr('sc:p:p2a', '00000000-0000-4000-8000-00000000e502', 9451000002000580, 580, 200, interval '2 days');
select pg_temp.pwr('sc:p:p2b', '00000000-0000-4000-8000-00000000e502', 9451000002000580, 580, 200, interval '1 hour');
select pg_temp.pwr('sc:p:p3a', '00000000-0000-4000-8000-00000000e503', 9451000003000580, 580, 300, interval '10 days');
select pg_temp.pwr('sc:p:p3b', '00000000-0000-4000-8000-00000000e503', 9451000003000580, 580, 320, interval '9 days');

insert into public.world_truck_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, truck_uuid, owner_game_uid)
values (gen_random_uuid(), 'train.list', 't', 'sc:truck:q2', now() - interval '2 hours',
        '00000000-0000-4000-8000-00000000e451', 580, 584, '9451', '9451000005000584');

-- 1-9. An admin.
select pg_temp.act_as('00000000-0000-4000-8000-000003450101');
set local role authenticated;
create temp table doc7 as select public.server_clash_compare(580, 584) as d;
create temp table doc30 as select public.server_clash_compare(580, 584, 30) as d;
grant select on doc7, doc30 to authenticated;

select is((select jsonb_array_length(d -> 'servers') from doc7), 2, 'both servers come back');
select is((select (e ->> 'active_players')::int from doc7, jsonb_array_elements(d -> 'servers') e
            where (e ->> 'server_id')::int = 580), 1,
  'on 580 only the player whose power grew is active');
select is((select (e ->> 'members_seen')::int from doc7, jsonb_array_elements(d -> 'servers') e
            where (e ->> 'server_id')::int = 580), 3,
  'though all three members are seen on the map');
select is((select (e ->> 'total_power')::bigint from doc7, jsonb_array_elements(d -> 'servers') e
            where (e ->> 'server_id')::int = 580), 670::bigint,
  'power counts everyone seen with a reading, newest each, even one older than the window');
select is((select (e ->> 'unseen_members')::int from doc7, jsonb_array_elements(d -> 'servers') e
            where (e ->> 'server_id')::int = 580), 27,
  'the alliance''s other 27 members were never seen: they need a scan');
select is((select (e ->> 'active_players')::int from doc7, jsonb_array_elements(d -> 'servers') e
            where (e ->> 'server_id')::int = 584), 2,
  'on 584 a moved base and a truck both count');
select is((select (e ->> 'no_power_reading')::int from doc7, jsonb_array_elements(d -> 'servers') e
            where (e ->> 'server_id')::int = 584), 2,
  'and both are said to have no power reading');
select is((select jsonb_array_length(d -> 'alliances') from doc7), 2,
  'one top alliance per server in this fixture');
select is((select (e ->> 'moving')::boolean from doc7, jsonb_array_elements(d -> 'players') e
            where e ->> 'name' = 'p2'), false,
  'a player seen but not moving is listed, as not moving');
select is((select (e ->> 'active_players')::int from doc30, jsonb_array_elements(d -> 'servers') e
            where (e ->> 'server_id')::int = 580), 2,
  'a 30-day window brings in the one who grew ten days ago');

-- 11-13. Everybody else is refused.
select pg_temp.act_as('00000000-0000-4000-8000-000003450102');
select throws_ok($$ select public.server_clash_compare(580, 584) $$, '42501', null,
  'an officer is refused');
select pg_temp.act_as('00000000-0000-4000-8000-000003450103');
select throws_ok($$ select public.server_clash_compare(580, 584) $$, '42501', null,
  'a member is refused');
select pg_temp.act_as('00000000-0000-4000-8000-000003450104');
select throws_ok($$ select public.server_clash_compare(580, 584) $$, '42501', null,
  'community is refused');
reset role;

-- 14. Anon has no execute grant.
set local role anon;
select throws_ok($$ select public.server_clash_compare(580, 584) $$, '42501', null,
  'anon cannot call it');
reset role;

select * from finish();
rollback;
