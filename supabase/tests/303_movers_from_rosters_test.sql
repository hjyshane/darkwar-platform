-- 0303: movers are also read from alliance rosters.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a8001', 'movers-roster-test');
insert into public.servers (server_id, server_group) values (570, 'test'), (571, 'test')
on conflict do nothing;

-- ---------------------------------------------------------------- alliance rosters
-- A member list: Rostered (uid ends 571, on 570 now - a mover) and Native (uid ends 570).
-- Neither is on a state list, so they are only reachable through the roster.
insert into public.alliances (alliance_id, server_id, external_id, current_name) values
  ('00000000-0000-4000-8000-0000000a8a01', 570, 'ext-mv-roster', 'RosterCrew');
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a8b04', 571, 9362000000000571, 'Rostered'),
  ('00000000-0000-4000-8000-0000000a8b05', 570, 9362000000000570, 'Native');
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id, name,
   power, presence_redacted)
values
  (gen_random_uuid(), 'al.rank', 't', 'mv:r1', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000a8001', 570, '00000000-0000-4000-8000-0000000a8a01', 570,
   9362000000000571, '00000000-0000-4000-8000-0000000a8b04', 'Rostered', 800, true),
  -- an older reading of the same member, read before they moved
  (gen_random_uuid(), 'al.rank', 't', 'mv:r0', now() - interval '9 days',
   '00000000-0000-4000-8000-0000000a8001', 571, '00000000-0000-4000-8000-0000000a8a01', 571,
   9362000000000571, '00000000-0000-4000-8000-0000000a8b04', 'Rostered', 750, true),
  (gen_random_uuid(), 'al.rank', 't', 'mv:r2', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000a8001', 570, '00000000-0000-4000-8000-0000000a8a01', 570,
   9362000000000570, '00000000-0000-4000-8000-0000000a8b05', 'Native', 400, true);

select is((select array_agg(name order by name) from public.migration_movers(570, 571, 570, 571)),
          array['Rostered'], 'a member of an alliance roster who moved is a mover too');
select is((select source from public.migration_movers(570, 571, 570, 571) where name = 'Rostered'),
          'roster', 'with the roster as the source');
select is((select alliance_name from public.migration_movers(570, 571, 570, 571) where name = 'Rostered'),
          'RosterCrew', 'and the roster''s alliance');
select is((select power from public.migration_movers(570, 571, 570, 571) where name = 'Rostered'),
          800::bigint, 'read from the newest reading, not the one before the move');
select is((select count(*)::int from public.migration_movers(570, 571, 570, 571) where name = 'Native'), 0,
          'a member on the server their uid names is not a mover');


select * from finish();
rollback;
