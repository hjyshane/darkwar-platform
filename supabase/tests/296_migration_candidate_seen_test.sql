-- 0296: a candidate outside the state lists is found from any snapshot, and placed by power.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a6001', 'seen-test');
insert into public.servers (server_id, server_group) values (567, 'test'), (568, 'test')
on conflict do nothing;
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a6b01', 567, 9340000000000567, 'Listed'),
  ('00000000-0000-4000-8000-0000000a6b02', 568, 9340000000000568, 'Strong'),
  ('00000000-0000-4000-8000-0000000a6b03', 567, 9340000000001567, 'Weak One');

-- A state list of server 567: two players, 900 and 500.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power)
values
  ('00000000-0000-4000-8000-0000000a6c01', 'cross.server.rank', 't', 'seen:1', now(),
   '00000000-0000-4000-8000-0000000a6001', 567, '00000000-0000-4000-8000-0000000a6b01', 567,
   9340000000000567, 'Listed', 900),
  ('00000000-0000-4000-8000-0000000a6c01', 'cross.server.rank', 't', 'seen:2', now(),
   '00000000-0000-4000-8000-0000000a6001', 567, '00000000-0000-4000-8000-0000000a6b02', 567,
   9340000000000568, 'Strong', 500);
-- Weak One is not on the list; a profile was opened at 400 (old) and again at 450.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power, raw)
values
  (gen_random_uuid(), 'get.user.info.multi', 't', 'seen:3', now() - interval '3 days',
   '00000000-0000-4000-8000-0000000a6001', 567, '00000000-0000-4000-8000-0000000a6b03', 567,
   9340000000001567, 'Weak One', 400, '{"allianceName": "Old Crew"}'),
  (gen_random_uuid(), 'get.user.info.multi', 't', 'seen:4', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000a6001', 567, '00000000-0000-4000-8000-0000000a6b03', 567,
   9340000000001567, 'Weak One', 450, '{"allianceName": "New Crew"}');

select is((select power from public.migration_candidate_seen('{}', array[9340000000001567::bigint])),
          450::bigint, 'the newest snapshot of any kind wins');
select is((select server_id from public.migration_candidate_seen(array['weak one'])), 567,
          'and the name finds the player, ignoring case');
select is((select estimated_rank from public.migration_candidate_seen(array['Weak One'])), 3::bigint,
          'the place is one past the listed players who are stronger');
select is((select estimated_rank from public.migration_candidate_seen(array['Listed'])), 1::bigint,
          'a listed player comes out where the list puts them');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a6f01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'seen-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000a6f02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'seen-member@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000a6f01', 'officer'),
  ('00000000-0000-4000-8000-0000000a6f02', 'member');
set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000a6f01')::text, true);
select is((select alliance_name from public.migration_candidate_seen(array['Weak One'])), 'New Crew',
          'an officer gets the alliance from the newest snapshot');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000a6f02')::text, true);
select is((select alliance_name from public.migration_candidate_seen(array['Weak One'])), null,
          'a member does not');

select * from finish();
rollback;
