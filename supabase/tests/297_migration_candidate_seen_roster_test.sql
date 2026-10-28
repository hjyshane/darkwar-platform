-- 0297: a candidate known only from an alliance roster is found, with that alliance.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.servers (server_id, server_group) values (570, 'test') on conflict do nothing;
insert into public.alliances (alliance_id, server_id, external_id, current_name) values
  ('00000000-0000-4000-8000-0000000a7a01', 570, 'ext-roster-seen', 'RosterCrew');
insert into public.players (player_id, server_id, game_uid, current_name, power,
                            current_alliance_id, roster_observed_at) values
  ('00000000-0000-4000-8000-0000000a7b01', 570, 9350000000000570, 'Roster Only', 700,
   '00000000-0000-4000-8000-0000000a7a01', now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000a7b02', 570, 9350000000001570, 'No Power', null,
   '00000000-0000-4000-8000-0000000a7a01', now() - interval '2 days');

select is((select power from public.migration_candidate_seen(array['roster only'])), 700::bigint,
          'a player seen only in a roster is found, by name');
select is((select source_command from public.migration_candidate_seen('{}', array[9350000000000570::bigint])),
          'roster', 'and by uid, and the source says roster');
select is((select alliance_name from public.migration_candidate_seen(array['Roster Only'])),
          'RosterCrew', 'with the alliance of that roster');
select is((select server_id from public.migration_candidate_seen(array['Roster Only'])), 570,
          'and the server');
select is((select count(*)::int from public.migration_candidate_seen(array['No Power'])), 0,
          'a roster row with no power says nothing');

select * from finish();
rollback;
