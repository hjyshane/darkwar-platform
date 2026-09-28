-- 0186: a server migration is read as before and after — who moved, who
-- stayed, who went unseen, who appeared — per person, per server, per flow
-- and per alliance, with an alliance that moved server read as one.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- Dates sit in 2027 so nothing the seed or another fixture wrote falls on
-- either side of the event.
--
-- Event: baseline 2027-01-10, settled 2027-01-20.
-- People (uid suffix = home server):
--   A  580 -> 581  top #1 on both boards, stays in alliance X as X moves
--   B  580 -> 580  top #2 on both boards, leaves X without moving
--   C  581 -> ?    top #3 before, never seen after
--   D  ?   -> 582  top #3 after only
--   E  ?   -> 580  top #4 after; its only earlier sighting is stale
--   F  580 -> ?    on X's before roster, never seen after
--   G  ?   -> 581  joins X after the move
--   H  580 -> 582  on X's before roster, seen after on 582 by a profile open
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-00000000e001', 580, 9500000001000580, 'A'),
  ('00000000-0000-4000-8000-00000000e002', 580, 9500000002000580, 'B'),
  ('00000000-0000-4000-8000-00000000e003', 581, 9500000003000581, 'C'),
  ('00000000-0000-4000-8000-00000000e004', 582, 9500000004000582, 'D'),
  ('00000000-0000-4000-8000-00000000e005', 581, 9500000005000581, 'E'),
  ('00000000-0000-4000-8000-00000000e006', 580, 9500000006000580, 'F'),
  ('00000000-0000-4000-8000-00000000e007', 581, 9500000007000581, 'G'),
  ('00000000-0000-4000-8000-00000000e008', 580, 9500000008000580, 'H');

-- Alliance X, before on 580 and after on 581: two `alliances` rows, one
-- game id.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-00000000ea01', 580, 'm1c0000000000000000000000000000x', 'Ex', 'EX'),
  ('00000000-0000-4000-8000-00000000ea02', 581, 'm1c0000000000000000000000000000x', 'Ex', 'EX');

create function pg_temp.seen(key text, cmd text, at timestamptz, who uuid, uid bigint,
                              srv int, pwr bigint, rnk int)
returns void language sql as $$
  insert into public.player_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, raw, player_id, server_id, game_uid,
     name, power, rank)
  values ('00000000-0000-4000-8000-00000000e0f1', cmd, 'test', key, at,
          '00000000-0000-4000-8000-000000000c01', 580, '{"abbr": "EX"}'::jsonb,
          who, srv, uid, 'n' || uid, pwr, rnk);
$$;

create function pg_temp.member(key text, alliance uuid, at timestamptz, who uuid, uid bigint,
                                srv int, pwr bigint)
returns void language sql as $$
  insert into public.alliance_member_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, alliance_id, server_id, player_id,
     game_uid, name, power)
  values ('00000000-0000-4000-8000-00000000e0f2', 'al.rank', 'test', key, at,
          '00000000-0000-4000-8000-000000000c01', 580, alliance, srv, who, uid,
          'n' || uid, pwr);
$$;

create function pg_temp.board(key text, alliance uuid, at timestamptz, srv int,
                               pwr bigint, members int)
returns void language sql as $$
  insert into public.alliance_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, alliance_id, server_id, external_id,
     name, code, power, member_count, rank)
  values ('00000000-0000-4000-8000-00000000e0f3', 'alliance.rank', 'test', key, at,
          '00000000-0000-4000-8000-000000000c01', 580, alliance, srv,
          'm1c0000000000000000000000000000x', 'Ex', 'EX', pwr, members, 1);
$$;

-- Before: the top board on 01-09 (one batch, one instant), X's roster on
-- 01-08, X on the alliance board on 01-09, and E's stale sighting.
select pg_temp.seen('t:mig:b1', 'server.rank', '2027-01-09T02:05:00Z',
  '00000000-0000-4000-8000-00000000e001', 9500000001000580, 580, 1000, 1);
select pg_temp.seen('t:mig:b2', 'server.rank', '2027-01-09T02:05:00Z',
  '00000000-0000-4000-8000-00000000e002', 9500000002000580, 580, 900, 2);
select pg_temp.seen('t:mig:b3', 'server.rank', '2027-01-09T02:05:00Z',
  '00000000-0000-4000-8000-00000000e003', 9500000003000581, 581, 800, 3);
select pg_temp.seen('t:mig:stale', 'server.rank', '2026-12-01T02:05:00Z',
  '00000000-0000-4000-8000-00000000e005', 9500000005000581, 581, 500, 9);

select pg_temp.member('t:mig:rb1', '00000000-0000-4000-8000-00000000ea01', '2027-01-08T12:00:00Z',
  '00000000-0000-4000-8000-00000000e001', 9500000001000580, 580, 990);
select pg_temp.member('t:mig:rb2', '00000000-0000-4000-8000-00000000ea01', '2027-01-08T12:00:00Z',
  '00000000-0000-4000-8000-00000000e002', 9500000002000580, 580, 890);
select pg_temp.member('t:mig:rb6', '00000000-0000-4000-8000-00000000ea01', '2027-01-08T12:00:00Z',
  '00000000-0000-4000-8000-00000000e006', 9500000006000580, 580, 50);
select pg_temp.member('t:mig:rb8', '00000000-0000-4000-8000-00000000ea01', '2027-01-08T12:00:00Z',
  '00000000-0000-4000-8000-00000000e008', 9500000008000580, 580, 70);

select pg_temp.board('t:mig:ab', '00000000-0000-4000-8000-00000000ea01',
  '2027-01-09T02:05:00Z', 580, 5000, 4);

-- After: the top board on 01-21, X's roster (now on 581) on 01-22, H's
-- profile on 01-23, X on the alliance board on 01-21.
select pg_temp.seen('t:mig:a1', 'server.rank', '2027-01-21T02:05:00Z',
  '00000000-0000-4000-8000-00000000e001', 9500000001000580, 581, 1100, 1);
select pg_temp.seen('t:mig:a2', 'server.rank', '2027-01-21T02:05:00Z',
  '00000000-0000-4000-8000-00000000e002', 9500000002000580, 580, 950, 2);
select pg_temp.seen('t:mig:a4', 'server.rank', '2027-01-21T02:05:00Z',
  '00000000-0000-4000-8000-00000000e004', 9500000004000582, 582, 850, 3);
select pg_temp.seen('t:mig:a5', 'server.rank', '2027-01-21T02:05:00Z',
  '00000000-0000-4000-8000-00000000e005', 9500000005000581, 580, 600, 4);

select pg_temp.member('t:mig:ra1', '00000000-0000-4000-8000-00000000ea02', '2027-01-22T12:00:00Z',
  '00000000-0000-4000-8000-00000000e001', 9500000001000580, 581, 1120);
select pg_temp.member('t:mig:ra7', '00000000-0000-4000-8000-00000000ea02', '2027-01-22T12:00:00Z',
  '00000000-0000-4000-8000-00000000e007', 9500000007000581, 581, 300);

select pg_temp.seen('t:mig:h', 'get.user.info.multi', '2027-01-23T12:00:00Z',
  '00000000-0000-4000-8000-00000000e008', 9500000008000580, 582, 75, null);

select pg_temp.board('t:mig:aa', '00000000-0000-4000-8000-00000000ea02',
  '2027-01-21T02:05:00Z', 581, 6000, 2);

insert into public.migration_events (event_id, name, baseline_at, settled_at) values
  ('00000000-0000-4000-8000-00000000e101', 'settled', '2027-01-10T00:00:00Z', '2027-01-20T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000e102', 'late settle', '2027-01-10T00:00:00Z', '2027-01-21T12:00:00Z'),
  ('00000000-0000-4000-8000-00000000e103', 'live', '2027-01-10T00:00:00Z', null);

-- By the player_id the fixture gave each letter. Not by players.current_name:
-- the snapshot triggers overwrite it with the snapshot's name ('n' || uid).
create function pg_temp.status(ev uuid, who text) returns text language sql as $$
  select p.status from public.migration_people(ev) p
   where p.player_id = ('00000000-0000-4000-8000-00000000e00'
                        || (ascii(who) - ascii('A') + 1)::text)::uuid;
$$;

-- People.
select is((select count(*)::int
             from public.migration_people('00000000-0000-4000-8000-00000000e101')), 8,
  'one row per observed person');
select is(pg_temp.status('00000000-0000-4000-8000-00000000e101', 'A'), 'moved',
  'A, 580 before and 581 after, moved');
select is(pg_temp.status('00000000-0000-4000-8000-00000000e101', 'B'), 'stayed',
  'B, 580 on both sides, stayed');
select is(pg_temp.status('00000000-0000-4000-8000-00000000e101', 'C'), 'unseen_after',
  'C, not seen after, is unseen rather than moved');
select is(pg_temp.status('00000000-0000-4000-8000-00000000e101', 'D'), 'appeared',
  'D, only after, appeared');
select is(pg_temp.status('00000000-0000-4000-8000-00000000e101', 'E'), 'appeared',
  'a sighting older than 14 days before the baseline is not a before side');
select is(pg_temp.status('00000000-0000-4000-8000-00000000e101', 'H'), 'moved',
  'H, seen after only by a profile open, moved');

select is((select (before_rank, after_rank, before_server_id, after_server_id)::text
             from public.migration_people('00000000-0000-4000-8000-00000000e101')
            where game_uid = 9500000001000580),
          '(1,1,580,581)', 'A carries both board ranks and both servers');
select is((select (before_power, after_power)::text
             from public.migration_people('00000000-0000-4000-8000-00000000e101')
            where game_uid = 9500000001000580),
          '(1000,1120)', 'power is read from the newest observation on each side');
select is((select home_server_id
             from public.migration_people('00000000-0000-4000-8000-00000000e101')
            where game_uid = 9500000001000580),
          580, 'the home server is the UID suffix');

-- The after side starts at settled_at, or at the baseline while unsettled.
select is(pg_temp.status('00000000-0000-4000-8000-00000000e102', 'B'), 'unseen_after',
  'a board read before settled_at is not the after side');
select is(pg_temp.status('00000000-0000-4000-8000-00000000e103', 'B'), 'stayed',
  'while unsettled the after side is anything after the baseline');

-- Servers.
select is((select (tracked_before, tracked_after, stayed, moved_out, moved_in,
                   unseen_after, appeared)::text
             from public.migration_servers('00000000-0000-4000-8000-00000000e101')
            where server_id = 580),
          '(4,2,1,2,0,1,1)', '580: four before, two after, two moved out');
select is((select (tracked_before, tracked_after, moved_in)::text
             from public.migration_servers('00000000-0000-4000-8000-00000000e101')
            where server_id = 581),
          '(1,2,1)', '581: one before, A moved in, G appeared');
select is((select (top_before, top_after)::text
             from public.migration_servers('00000000-0000-4000-8000-00000000e101')
            where server_id = 580),
          '(2,2)', '580 held two top-150 places before and after');
select is((select (top_before, top_after, top_power_after)::text
             from public.migration_servers('00000000-0000-4000-8000-00000000e101')
            where server_id = 582),
          '(0,1,850)', '582 gained a top-150 place, D''s');
select is((select (power_out)::text
             from public.migration_servers('00000000-0000-4000-8000-00000000e101')
            where server_id = 580),
          '1070', 'power moved out of 580 is A''s and H''s before power');

-- Flows.
select is((select count(*)::int
             from public.migration_flows('00000000-0000-4000-8000-00000000e101')), 2,
  'two routes were taken');
select is((select (movers, top_movers)::text
             from public.migration_flows('00000000-0000-4000-8000-00000000e101')
            where from_server_id = 580 and to_server_id = 581),
          '(1,1)', '580 -> 581 carried A, a top-150 player');

-- Top board.
select is((select count(*)::int
             from public.migration_top_board('00000000-0000-4000-8000-00000000e101')), 5,
  'the top board lists everyone on either batch: A B C D E');

-- Alliances.
select is((select (before_server_id, after_server_id)::text
             from public.migration_alliances('00000000-0000-4000-8000-00000000e101')
            where external_id = 'm1c0000000000000000000000000000x'),
          '(580,581)', 'an alliance that moved server is one row with both servers');
select is((select (members_before, members_after, stayed, left_alliance, left_by_moving, joined)::text
             from public.migration_alliances('00000000-0000-4000-8000-00000000e101')
            where external_id = 'm1c0000000000000000000000000000x'),
          '(4,2,1,3,1,1)', 'X: four before, two after; B F H left, H by moving; G joined');
select is((select (roster_power_before, roster_power_after)::text
             from public.migration_alliances('00000000-0000-4000-8000-00000000e101')
            where external_id = 'm1c0000000000000000000000000000x'),
          '(2000,1420)', 'roster power is summed on each side');
select is((select (board_power_before, board_power_after, board_members_before, board_members_after)::text
             from public.migration_alliances('00000000-0000-4000-8000-00000000e101')
            where external_id = 'm1c0000000000000000000000000000x'),
          '(5000,6000,4,2)', 'the alliance board is read on each side');
select is((select left_alliance
             from public.migration_alliances('00000000-0000-4000-8000-00000000e102')
            where external_id = 'm1c0000000000000000000000000000x'),
          3::bigint, 'churn is counted against the after roster');

-- Access.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000e301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mig-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000e302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mig-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e301', 'member', 'mig member'),
  ('00000000-0000-4000-8000-00000000e302', 'officer', 'mig officer');

set local role anon;
select throws_ok(
  $$ select * from public.migration_people('00000000-0000-4000-8000-00000000e101') $$,
  '42501', null, 'anon cannot read the migration board');
reset role;

set local role authenticated;
select is_empty(
  $$ select * from public.migration_servers('00000000-0000-4000-8000-00000000e101') $$,
  'a signed-in request with no member role reads nothing');
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000e301')::text, true);
-- 0191: officers and admins only. The rosters under it are own-or-officer
-- (0066), so a member would otherwise get the power board's people and
-- none of the roster's.
select is_empty(
  $$ select * from public.migration_people('00000000-0000-4000-8000-00000000e101') $$,
  'a member reads nothing, rather than the power board without the rosters');
select throws_ok(
  $$ insert into public.migration_events (name, baseline_at) values ('x', now()) $$,
  '42501', null, 'a member cannot add a migration');
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000e302')::text, true);
select is((select count(*)::int
             from public.migration_people('00000000-0000-4000-8000-00000000e101')), 8,
  'an officer reads the whole board, rosters included');
select lives_ok(
  $$ insert into public.migration_events (name, baseline_at) values ('x', now()) $$,
  'an officer can add a migration');
reset role;

select * from finish();
rollback;
