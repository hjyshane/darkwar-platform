-- 0258: a listed truck carries its route and current leg through the view, and
-- the station table is readable by a member and by nobody else.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000e401', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rt-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000e402', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rt-stranger@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e401', 'member', 'rt member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000e411', 'truck-route-test');
insert into public.game_train_stations (station_no, point_id, x, y)
values (43, 491444, 443, 491), (56, 691392, 391, 691);

insert into public.world_truck_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, truck_uuid, quality,
   start_pos, arrive_at, hero_fragments, goods,
   stations, station_index, leg_start_at, leg_end_at)
values (gen_random_uuid(), 'train.list', 't', 'route:list', now(),
        '00000000-0000-4000-8000-00000000e411', 580, 584, '9100', 5,
        491444, now() + interval '1 hour', 1, '[{"id":"210454","num":1}]'::jsonb,
        '[43, 56, 60]'::jsonb, 1, now() - interval '2 minutes', now() + interval '3 minutes');

select pg_temp.act_as('00000000-0000-4000-8000-00000000e401');
set local role authenticated;

select is((select stations from public.world_trucks_latest where truck_uuid = '9100'),
  '[43, 56, 60]'::jsonb, 'the route comes through the view');
select is((select station_index::int from public.world_trucks_latest where truck_uuid = '9100'), 1,
  'and the station it is heading for');
select ok((select leg_end_at > leg_start_at from public.world_trucks_latest where truck_uuid = '9100'),
  'and when the leg starts and ends');
select is((select count(*)::int from public.game_train_stations), 2, 'a member reads the stations');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e402');
set local role authenticated;
select is((select count(*)::int from public.game_train_stations), 0,
  'a user with no role reads none');

reset role;
select ok(not has_table_privilege('anon', 'public.game_train_stations', 'select'),
  'anon reads nothing');

select * from finish();
rollback;
