-- 0301: a player known only from a state list is on the cross-server power ranking.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a9001', 'rank-list-test');
insert into public.servers (server_id, server_group) values (566, 'test') on conflict do nothing;
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a9b01', 566, 9370000000000566, 'List Only'),
  ('00000000-0000-4000-8000-0000000a9b02', 566, 9370000000001566, 'List Second');

insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power)
values
  ('00000000-0000-4000-8000-0000000a9c01', 'cross.server.rank', 't', 'rk:1', now() - interval '2 days',
   '00000000-0000-4000-8000-0000000a9001', 580, '00000000-0000-4000-8000-0000000a9b01', 566,
   9370000000000566, 'List Only', 123456789012),
  ('00000000-0000-4000-8000-0000000a9c01', 'cross.server.rank', 't', 'rk:2', now() - interval '2 days',
   '00000000-0000-4000-8000-0000000a9001', 580, '00000000-0000-4000-8000-0000000a9b02', 566,
   9370000000001566, 'List Second', 100);

select is((select value from public.player_ranking_merged('power') where game_uid = 9370000000000566),
          123456789012::bigint, 'a player on a state list is on the power ranking');
select is((select source from public.player_ranking_merged('power') where game_uid = 9370000000000566),
          'board', 'as a board reading');
select is((select rank from public.player_ranking_merged('power') where game_uid = 9370000000000566),
          1, 'ranked by power with everybody else');
select is((select count(*)::int from public.player_ranking_merged('kills') where game_uid = 9370000000000566),
          0, 'and the kills ranking is untouched');

select * from finish();
rollback;
