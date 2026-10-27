-- 0294: the top of the merged board, in order, cut at the limit.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a4001', 'tier-board-test');
insert into public.servers (server_id, server_group) values (567, 'test'), (568, 'test')
on conflict do nothing;
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a4b01', 567, 9330000000000567, 'One'),
  ('00000000-0000-4000-8000-0000000a4b02', 568, 9330000000000568, 'Two'),
  ('00000000-0000-4000-8000-0000000a4b03', 567, 9330000000001567, 'Three');

insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power, raw)
values
  ('00000000-0000-4000-8000-0000000a4c01', 'cross.server.rank', 't', 'tb:1', now(),
   '00000000-0000-4000-8000-0000000a4001', 567, '00000000-0000-4000-8000-0000000a4b01', 567,
   9330000000000567, 'One', 900, '{"allianceName": "Crew"}'),
  ('00000000-0000-4000-8000-0000000a4c01', 'cross.server.rank', 't', 'tb:3', now(),
   '00000000-0000-4000-8000-0000000a4001', 567, '00000000-0000-4000-8000-0000000a4b03', 567,
   9330000000001567, 'Three', 100, '{"allianceName": "Crew"}'),
  ('00000000-0000-4000-8000-0000000a4c02', 'cross.server.rank', 't', 'tb:2', now(),
   '00000000-0000-4000-8000-0000000a4001', 567, '00000000-0000-4000-8000-0000000a4b02', 568,
   9330000000000568, 'Two', 500, '{"allianceName": "Crew"}');

select is((select array_agg(name order by overall_rank) from public.migration_tier_board()),
          array['One', 'Two', 'Three'], 'both servers merged, strongest first');
select is((select count(*)::int from public.migration_tier_board(2)), 2,
          'cut at the limit');
select is((select overall_rank from public.migration_tier_board() where name = 'Three'), 3::bigint,
          'the place counts across servers');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a4f01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tier-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000a4f02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tier-officer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000a4f01', 'member'),
  ('00000000-0000-4000-8000-0000000a4f02', 'officer');
set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000a4f02')::text, true);
select is((select count(*)::int from public.migration_tier_board() where alliance_name = 'Crew'), 3,
          'an officer gets the alliance names with the board');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000a4f01')::text, true);
select is((select count(*)::int from public.migration_tier_board()), 3,
          'a member still gets the board');
select is((select count(*)::int from public.migration_tier_board() where alliance_name is not null), 0,
          'but no alliance names');

select * from finish();
rollback;
