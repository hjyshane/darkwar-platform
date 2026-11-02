-- 0305: the migration boards by server and by alliance.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000aa001', 'stats-test');
insert into public.servers (server_id, server_group) values (570, 'test'), (571, 'test')
on conflict do nothing;
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000aab01', 570, 9390000000000570, 'Top 570'),
  ('00000000-0000-4000-8000-0000000aab02', 570, 9391000000000571, 'Came from 571'),
  ('00000000-0000-4000-8000-0000000aab03', 571, 9390000000000571, 'Top 571');

-- State lists: server 570 holds a native and a player who started on 571; 571 holds one.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power)
values
  ('00000000-0000-4000-8000-0000000aac01', 'cross.server.rank', 't', 'st:1', now(),
   '00000000-0000-4000-8000-0000000aa001', 570, '00000000-0000-4000-8000-0000000aab01', 570,
   9390000000000570, 'Top 570', 900),
  ('00000000-0000-4000-8000-0000000aac01', 'cross.server.rank', 't', 'st:2', now(),
   '00000000-0000-4000-8000-0000000aa001', 570, '00000000-0000-4000-8000-0000000aab02', 570,
   9391000000000571, 'Came from 571', 500),
  ('00000000-0000-4000-8000-0000000aac02', 'cross.server.rank', 't', 'st:3', now() - interval '2 days',
   '00000000-0000-4000-8000-0000000aa001', 571, '00000000-0000-4000-8000-0000000aab03', 571,
   9390000000000571, 'Top 571', 700);

-- ------------------------------------------------------------ one server's list
select is((select array_agg(name order by server_place) from public.migration_server_top(570, 150, 570, 571)),
          array['Top 570', 'Came from 571'], 'a server''s list in the order of its power');
select is((select board_rank from public.migration_server_top(570, 150, 570, 571) where name = 'Came from 571'),
          3::bigint, 'each placed on the merged board');
select is((select home_server from public.migration_server_top(570, 150, 570, 571) where name = 'Came from 571'),
          571, 'with the server their uid names');
select is((select count(*)::int from public.migration_server_top(570, 1, 570, 571)), 1, 'cut at the limit');

-- ------------------------------------------------------------------ per server
select is((select listed from public.migration_server_stats(570, 571, 570, 571) where server_id = 570),
          2::bigint, 'a server''s list holds what it holds');
select is((select moved_in from public.migration_server_stats(570, 571, 570, 571) where server_id = 570),
          1::bigint, 'one arrived on 570');
select is((select moved_out from public.migration_server_stats(570, 571, 570, 571) where server_id = 571),
          1::bigint, 'and one left 571');
select is((select commanders from public.migration_server_stats(570, 571, 570, 571) where server_id = 570),
          2::bigint, 'the board puts all three in the first ten places');

-- --------------------------------------------------------------- per alliance
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code) values
  ('00000000-0000-4000-8000-0000000aaa01', 570, 'ext-stats-crew', 'StatsCrew', 'STC');
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, name, power,
   presence_redacted)
values
  ('00000000-0000-4000-8000-0000000aad01', 'al.rank', 't', 'st:r1', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000aa001', 570, '00000000-0000-4000-8000-0000000aaa01', 570,
   9392000000000570, 'Native', 300, true),
  ('00000000-0000-4000-8000-0000000aad01', 'al.rank', 't', 'st:r2', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000aa001', 570, '00000000-0000-4000-8000-0000000aaa01', 570,
   9393000000000571, 'Mover', 200, true);

select is((select members from public.migration_alliance_stats(10, 570, 571, 570, 571) where name = 'StatsCrew'),
          2::bigint, 'an alliance''s members from its newest member list');
select is((select moved from public.migration_alliance_stats(10, 570, 571, 570, 571) where name = 'StatsCrew'),
          1::bigint, 'and how many of them started on another server');
select is((select total_power from public.migration_alliance_stats(10, 570, 571, 570, 571) where name = 'StatsCrew'),
          500::bigint, 'with their power added up');

select * from finish();
rollback;
