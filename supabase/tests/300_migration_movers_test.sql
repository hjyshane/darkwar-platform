-- 0300: movers are the players whose current server differs from the one their uid ends in.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a8001', 'movers-test');
insert into public.servers (server_id, server_group) values (570, 'test'), (571, 'test')
on conflict do nothing;
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a8b01', 570, 9360000000000570, 'Stayer'),
  ('00000000-0000-4000-8000-0000000a8b02', 570, 9361000000000571, 'Arrived'),
  ('00000000-0000-4000-8000-0000000a8b03', 571, 9360000000000571, 'Home 571');

-- Server 570's list: one native, one whose uid ends in 571. Server 571's list is older.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power, raw)
values
  ('00000000-0000-4000-8000-0000000a8c01', 'cross.server.rank', 't', 'mv:1', now(),
   '00000000-0000-4000-8000-0000000a8001', 570, '00000000-0000-4000-8000-0000000a8b01', 570,
   9360000000000570, 'Stayer', 900, '{"allianceName": "Crew"}'),
  ('00000000-0000-4000-8000-0000000a8c01', 'cross.server.rank', 't', 'mv:2', now(),
   '00000000-0000-4000-8000-0000000a8001', 570, '00000000-0000-4000-8000-0000000a8b02', 570,
   9361000000000571, 'Arrived', 500, '{"allianceName": "Crew"}'),
  ('00000000-0000-4000-8000-0000000a8c02', 'cross.server.rank', 't', 'mv:3', now() - interval '6 days',
   '00000000-0000-4000-8000-0000000a8001', 571, '00000000-0000-4000-8000-0000000a8b03', 571,
   9360000000000571, 'Home 571', 700, '{}');

select is((select array_agg(name) from public.migration_movers(570, 571, 570, 571)), array['Arrived'],
          'only the player whose uid ends elsewhere is a mover');
select is((select home_server from public.migration_movers(570, 571, 570, 571)), 571,
          'with the server the uid names as home');
select is((select server_id from public.migration_movers(570, 571, 570, 571)), 570,
          'and the one they are on now');
select is((select board_rank from public.migration_movers(570, 571, 570, 571)), 3::bigint,
          'placed on the merged board by power');

select is((select captured_at is null from public.migration_list_freshness(570, 572) where server_id = 572),
          true, 'a server with no list has no read time');
select is((select movers from public.migration_list_freshness(570, 571) where server_id = 570), 1::bigint,
          'freshness counts the movers on a list');
select is((select listed from public.migration_list_freshness(570, 571) where server_id = 571), 1::bigint,
          'and how many players it holds');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a8f01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mv-member@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000a8f01', 'member');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000a8f01')::text, true);
select is((select alliance_name from public.migration_movers(570, 571, 570, 571)), null,
          'a member does not get the alliance name');

select * from finish();
rollback;
