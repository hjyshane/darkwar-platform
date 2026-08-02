-- 0030/0031: the roster projection has its own clock, and an unredacted
-- roster is what marks an alliance as ours.
--
-- Both were found by running the dashboard against real data. The first is a
-- lost update that only appears when sources arrive in a particular order,
-- which is exactly the kind of thing a fixture replayed in one fixed order
-- never shows — so the order is inverted deliberately below.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-000000000c21', 'roster-clock-test')
on conflict do nothing;

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000a1001', 580, 'ext-ours', 'Ours', 'OUR'),
  ('00000000-0000-4000-8000-0000000a1002', 580, 'ext-theirs', 'Theirs', 'THR');

insert into public.players (player_id, game_uid, server_id, current_name)
values ('00000000-0000-4000-8000-0000000db001'::uuid, 58022222000580, 580, null);

create function pg_temp.roster(
  key text, alliance uuid, pname text, seen timestamptz, redacted boolean
) returns void language sql as $$
  insert into public.alliance_member_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, alliance_id, player_id,
     game_uid, name, power, presence_redacted)
  values
    ('00000000-0000-4000-8000-00000000f401', 'al.rank', 'test', key, seen,
     '00000000-0000-4000-8000-000000000c21', 580, 580, alliance,
     '00000000-0000-4000-8000-0000000db001'::uuid, 58022222000580, pname, 500, redacted);
$$;

-- A NEWER contribution lands first and advances players.last_seen_at. This is
-- what actually happens: donation boards are captured after the roster and
-- apply_contribution_summary writes last_seen_at itself.
insert into public.alliance_contribution_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid,
   contribution_type, score)
values
  ('00000000-0000-4000-8000-00000000f402', 'get.week.alliance.donate.rank', 'test',
   't:rc:contrib', '2026-08-01T12:00:00Z', '00000000-0000-4000-8000-000000000c21',
   580, 580, '00000000-0000-4000-8000-0000000db001'::uuid, 58022222000580,
   'weekly_donation', 86440);

select is((select last_seen_at from public.players
           where player_id = '00000000-0000-4000-8000-0000000db001'),
          '2026-08-01T12:00:00Z'::timestamptz,
  'a contribution advances last_seen_at, which is not the roster''s clock');

-- Now the OLDER roster arrives. Before 0030 this was refused entirely and the
-- alliance was never recorded, so the Members tab could not find its members.
select pg_temp.roster('t:rc:1', '00000000-0000-4000-8000-0000000a1001',
                      'Ours01', '2026-07-27T21:29:00Z', false);

select is((select current_alliance_id from public.players
           where player_id = '00000000-0000-4000-8000-0000000db001'),
          '00000000-0000-4000-8000-0000000a1001'::uuid,
  'a roster older than the last sighting still records the alliance');
select is((select current_name from public.players
           where player_id = '00000000-0000-4000-8000-0000000db001'), 'Ours01',
  'and the rest of the roster projection lands with it');
select is((select last_seen_at from public.players
           where player_id = '00000000-0000-4000-8000-0000000db001'),
          '2026-08-01T12:00:00Z'::timestamptz,
  'while last_seen_at is not dragged backwards to the older capture');

-- The roster's own clock still orders rosters against each other.
select pg_temp.roster('t:rc:2', '00000000-0000-4000-8000-0000000a1001',
                      'Stale', '2026-07-01T00:00:00Z', false);
select is((select current_name from public.players
           where player_id = '00000000-0000-4000-8000-0000000db001'), 'Ours01',
  'an older roster does not overwrite a newer one');

-- 0031/0032: ownership is evidence first. The trigger writes the OBSERVATION;
-- is_own is resolved from it when no admin pin exists, which is the case here.
select is((select roster_unredacted_seen from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a1001'), true,
  'an unredacted roster records the evidence of membership');

-- A redacted roster is another alliance's: the server hid presence because we
-- are not in it.
select pg_temp.roster('t:rc:3', '00000000-0000-4000-8000-0000000a1002',
                      'Theirs01', '2026-08-02T00:00:00Z', true);
select is((select roster_unredacted_seen from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a1002'), false,
  'a redacted roster is not evidence of membership');

-- Opening someone else's roster later must not unmark our own.
--
-- "With no pin set" is a precondition this test has to create rather than
-- hope for: an admin who has pinned an alliance from the dashboard leaves a
-- row in app_settings, and then is_own follows the pin and this assertion
-- fails for a reason that has nothing to do with rosters. Clearing it here
-- is safe — the file runs in a transaction that rolls back — and re-running
-- the resolver is what makes the cleared state take effect.
delete from public.app_settings where key = 'own_alliance';
select public.resolve_own_alliance();
select is((select is_own from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a1001'), true,
  'and with no pin set, is_own follows the evidence');

select * from finish();
rollback;
