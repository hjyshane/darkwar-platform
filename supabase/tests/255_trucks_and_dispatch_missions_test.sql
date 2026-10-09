-- 0254: trucks and dispatch missions. A member reads them, a signed-in user with
-- no role does not, a truck joins its position to its cargo, and what has
-- finished is gone from the views.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000e301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tr-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000e302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tr-stranger@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e301', 'member', 'tr member');
-- e302 has no app_users row: signed in, but nobody the app knows.

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000e001', 'truck-test');
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values ('00000000-0000-4000-8000-00000000e101', 580, 'ext-truck-ours', 'Ours', 'OURS');
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-00000000e201', 580, 9610000000000580, 'Plunder Owner');

insert into public.game_dispatch_missions
  (mission_id, color, star, duration_seconds, steal_max, orange_books)
values (9900001, 4, 2, 7200, 3, 6), (9900002, 3, 5, 3600, 3, 0);

create function pg_temp.mission(p_uuid text, p_id int, p_ends timestamptz, p_at timestamptz default now())
returns void language sql as $$
  insert into public.dispatch_mission_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, point_id, x, y, mission_id, mission_uuid,
     owner_game_uid, alliance_external_id, started_at, ends_at)
  values (gen_random_uuid(), 'world.get.new', 't', 'dm:' || p_uuid || p_at::text, p_at,
          '00000000-0000-4000-8000-00000000e001', 580, 580, 393447, 446, 393, p_id, p_uuid,
          9610000000000580, 'ext-truck-ours', p_ends - interval '2 hours', p_ends);
$$;

select pg_temp.mission('m-open', 9900001, now() + interval '1 hour');
select pg_temp.mission('m-done', 9900001, now() - interval '1 hour');
select pg_temp.mission('m-twice', 9900002, now() + interval '1 hour', now() - interval '10 minutes');
select pg_temp.mission('m-twice', 9900002, now() + interval '1 hour', now());

create function pg_temp.truck(p_key text, p_uuid text, p_arrive timestamptz, p_at timestamptz,
                              p_leg boolean, p_fragments int default null)
returns void language sql as $$
  insert into public.world_truck_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, truck_uuid, owner_name, quality,
     start_pos, target_pos, segment_start_at, segment_end_at, arrive_at, hero_fragments, goods)
  values (gen_random_uuid(), 'test', 't', p_key, p_at,
          '00000000-0000-4000-8000-00000000e001', 580, 581, p_uuid, 'Hauler', 5,
          case when p_leg then 706119 end, case when p_leg then 485422 end,
          case when p_leg then now() - interval '1 minute' end,
          case when p_leg then now() + interval '4 minutes' end,
          p_arrive, p_fragments,
          case when p_fragments is null then null else '[{"id":"210454","num":1}]'::jsonb end);
$$;

-- One truck seen twice: where it is, and what it carries.
select pg_temp.truck('t1:leg', '777', now() + interval '2 hours', now(), true);
select pg_temp.truck('t1:cargo', '777', now() + interval '2 hours', now() - interval '5 minutes',
                     false, 1);
-- A truck that reached its end an hour ago.
select pg_temp.truck('t2:cargo', '888', now() - interval '1 hour', now() - interval '2 hours',
                     false, 1);

select pg_temp.act_as('00000000-0000-4000-8000-00000000e301');
set local role authenticated;

select is((select count(*)::int from public.dispatch_missions_live), 2,
  'the open mission and the twice-seen one; the finished one is gone');
select is((select count(*)::int from public.dispatch_missions_live where mission_uuid = 'm-twice'), 1,
  'a mission seen twice is one row');
select is((select orange_books from public.dispatch_missions_live where mission_uuid = 'm-open'), 6,
  'the book count comes from the catalogue');
select is((select owner_name from public.dispatch_missions_live where mission_uuid = 'm-open'),
  'Plunder Owner', 'and the owner''s name from the players');
select is((select alliance_abbr from public.dispatch_missions_live where mission_uuid = 'm-open'),
  'OURS', 'and the alliance from its external id');
select is((select count(*)::int from public.world_trucks_latest), 1,
  'the truck on the road is listed once, the one that arrived an hour ago is not');
select is((select hero_fragments from public.world_trucks_latest where truck_uuid = '777'), 1,
  'its cargo came from the list');
select is((select target_pos from public.world_trucks_latest where truck_uuid = '777'), 485422,
  'its position from the march');
select ok((select cargo_seen_at < position_seen_at from public.world_trucks_latest where truck_uuid = '777'),
  'each half says how old it is');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e302');
set local role authenticated;
select is((select count(*)::int from public.dispatch_mission_snapshots), 0,
  'a user with no role reads no missions');
select is((select count(*)::int from public.world_truck_snapshots), 0,
  'and no trucks');

reset role;
select ok(not has_table_privilege('anon', 'public.world_trucks_latest', 'select'),
  'anon reads neither view');

select * from finish();
rollback;
