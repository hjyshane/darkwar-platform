-- 0292: the merged migration board, the place on it, and who may see migrate power.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a2001', 'board-test');
insert into public.servers (server_id, server_group) values (567, 'test'), (568, 'test')
on conflict do nothing;

-- Two servers, two lists. 567 was listed twice: the older list names a player (Gone)
-- who is not in the newer one and must not count.
insert into public.servers (server_id, server_group) values (569, 'test') on conflict do nothing;
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a2b05', 569, 9320000000000569, 'Delta'),
  ('00000000-0000-4000-8000-0000000a2b06', 569, 9320000000001569, 'Echo'),
  ('00000000-0000-4000-8000-0000000a2b01', 567, 9320000000000567, 'Alpha'),
  ('00000000-0000-4000-8000-0000000a2b02', 568, 9320000000000568, 'Bravo'),
  ('00000000-0000-4000-8000-0000000a2b03', 567, 9320000000001567, 'Charlie'),
  ('00000000-0000-4000-8000-0000000a2b04', 567, 9320000000002567, 'Gone');

create function pg_temp.put(p_obs uuid, p_player uuid, p_uid bigint, p_server int,
                            p_name text, p_power bigint, p_at timestamptz,
                            p_command text default 'cross.server.rank')
returns void language sql as $$
  insert into public.player_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power, raw)
  values (p_obs, p_command, 't', 'board:' || p_obs || p_uid, p_at,
          '00000000-0000-4000-8000-0000000a2001', 567, p_player, p_server, p_uid, p_name,
          p_power, jsonb_build_object('allianceName', 'Crew', 'rank', 1));
$$;

select pg_temp.put('00000000-0000-4000-8000-0000000a2c01', '00000000-0000-4000-8000-0000000a2b04',
                   9320000000002567, 567, 'Gone', 900, now() - interval '2 days');
select pg_temp.put('00000000-0000-4000-8000-0000000a2c02', '00000000-0000-4000-8000-0000000a2b01',
                   9320000000000567, 567, 'Alpha', 500, now() - interval '1 hour');
select pg_temp.put('00000000-0000-4000-8000-0000000a2c02', '00000000-0000-4000-8000-0000000a2b03',
                   9320000000001567, 567, 'Charlie', 100, now() - interval '1 hour');
select pg_temp.put('00000000-0000-4000-8000-0000000a2c03', '00000000-0000-4000-8000-0000000a2b02',
                   9320000000000568, 568, 'Bravo', 300, now() - interval '2 hours');

-- Server 569 comes as `server.rank`: a single-server list counts as its state list.
select pg_temp.put('00000000-0000-4000-8000-0000000a2c04', '00000000-0000-4000-8000-0000000a2b05',
                   9320000000000569, 569, 'Delta', 400, now() - interval '1 hour', 'server.rank');
-- A `server.rank` that mixes servers is the old group board, and is not a state list.
select pg_temp.put('00000000-0000-4000-8000-0000000a2c05', '00000000-0000-4000-8000-0000000a2b06',
                   9320000000001569, 569, 'Echo', 450, now() - interval '30 minutes', 'server.rank');
select pg_temp.put('00000000-0000-4000-8000-0000000a2c05', '00000000-0000-4000-8000-0000000a2b02',
                   9320000000000568, 568, 'Bravo', 450, now() - interval '30 minutes', 'server.rank');

select is((select overall_rank from public.migration_candidate_lookup(array['Delta'])), 2::bigint,
          'our own server''s list, sent as server.rank, is on the board');
select is((select count(*)::int from public.migration_candidate_lookup(array['Echo'])), 0,
          'a mixed server.rank is the group board and does not stand in for a state list');

select is((select count(*)::int from public.migration_candidate_lookup(array['Gone'])), 0,
          'a player missing from the newest list of their server is not on the board');

select is((select overall_rank from public.migration_candidate_lookup(array['  bravo '])), 3::bigint,
          'the place is across both servers, by power, and the name match ignores case and spaces');
select is((select overall_rank from public.migration_candidate_lookup(array['Charlie'])), 4::bigint,
          'a lower-powered player on the stronger server comes after the other server''s');
select is((select overall_rank from public.migration_candidate_lookup('{}', array[9320000000000567::bigint])),
          1::bigint, 'a uid finds the player as well');

select is((select listed from public.migration_board_info()), 4::bigint,
          'the board holds the newest list of each server only');
select is((select missing_servers from public.migration_board_info(567, 570)), array[570],
          'servers with no list are named');
select is((select rank_floor_unlisted from public.migration_board_info()), 2::bigint,
          'someone outside every list ranks at least one past those above the weakest cut-off');

-- Migrate power: written for Alpha, readable by an admin only.
insert into public.player_component_power_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, metric, power)
values (gen_random_uuid(), 'get.user.info.multi', 't', 'board:mig', now(),
        '00000000-0000-4000-8000-0000000a2001', 567,
        '00000000-0000-4000-8000-0000000a2b01', 567, 9320000000000567, 'migrate_power', 7777);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a2f01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'board-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000a2f02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'board-admin@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000a2f01', 'member'),
  ('00000000-0000-4000-8000-0000000a2f02', 'admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

select pg_temp.act_as('00000000-0000-4000-8000-0000000a2f01');
select is((select overall_rank from public.migration_candidate_lookup(array['Alpha'])), 1::bigint,
          'a member sees the place');
select is((select migrate_power from public.migration_candidate_lookup(array['Alpha'])), null,
          'but not the migrate power');

select pg_temp.act_as('00000000-0000-4000-8000-0000000a2f02');
select is((select migrate_power from public.migration_candidate_lookup(array['Alpha'])), 7777::bigint,
          'an admin gets it');

select * from finish();
rollback;
