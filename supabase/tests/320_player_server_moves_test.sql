-- 0320: player_server_moves - every server change, written as sightings land,
-- only from sightings whose payload named the server; read per player and per
-- server.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

select has_table('public', 'player_server_moves', 'player_server_moves exists');
select has_function('internal', 'record_server_sightings',
  array['uuid[]', 'integer[]', 'timestamp with time zone[]', 'text[]'],
  'the recorder exists, in internal');
select has_trigger('public', 'player_snapshots', 'record_server_moves',
  'player_snapshots records moves');
select has_trigger('public', 'alliance_member_snapshots', 'record_server_moves',
  'alliance_member_snapshots records moves');
select has_function('public', 'server_migration_flow', array['integer', 'timestamp with time zone'],
  'server_migration_flow(p_server, p_since) exists');
select has_function('public', 'server_migration_summary', array['timestamp with time zone'],
  'server_migration_summary(p_since) exists');

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000320c1', 'server-moves-test');

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values ('00000000-0000-4000-8000-0000000320a1', 575, 'ext-sm-575', 'Over There', 'OVR');

-- Every uid ends in 571: the server each account was made on.
insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-0000000320b1', 571, 98320000000571, 'Hopper', 1000),
  ('00000000-0000-4000-8000-0000000320b2', 580, 98320001000571, 'Unseen', 2000),
  ('00000000-0000-4000-8000-0000000320b3', 580, 98320002000571, 'Fallback', 3000),
  ('00000000-0000-4000-8000-0000000320b4', 571, 98320003000571, 'Torn', 4000),
  ('00000000-0000-4000-8000-0000000320b5', 571, 98320004000571, 'Stayer', 5000),
  ('00000000-0000-4000-8000-0000000320b6', 571, 98320005000571, 'Homecomer', 6000);

-- A board sighting. p_sid is what the payload said (null: it said nothing,
-- and the normalizer fell back to the uid's server).
create function pg_temp.board(p_player uuid, p_server int, p_sid int, p_at timestamptz, p_key text)
returns void language sql as $$
  insert into public.player_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, player_id, server_id, game_uid, power, raw)
  select gen_random_uuid(), 'cross.server.rank', 't', 'sm:' || p_key, p_at,
         '00000000-0000-4000-8000-0000000320c1', 580, p_player, p_server, p.game_uid, p.power,
         case when p_sid is null then '{}'::jsonb else jsonb_build_object('serverId', p_sid) end
    from public.players p where p.player_id = p_player;
$$;

-- Hopper: home, then 580, 580 again, then 575 on a roster.
select pg_temp.board('00000000-0000-4000-8000-0000000320b1', 571, 571, '2027-05-01T00:00:00Z', 'b1-1');
select pg_temp.board('00000000-0000-4000-8000-0000000320b1', 580, 580, '2027-05-03T00:00:00Z', 'b1-2');
select pg_temp.board('00000000-0000-4000-8000-0000000320b1', 580, 580, '2027-05-04T00:00:00Z', 'b1-3');
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id, name,
   power, raw)
values
  (gen_random_uuid(), 'al.rank', 't', 'sm:r1', '2027-05-10T00:00:00Z',
   '00000000-0000-4000-8000-0000000320c1', 575, '00000000-0000-4000-8000-0000000320a1', 575,
   98320000000571, '00000000-0000-4000-8000-0000000320b1', 'Hopper', 1000,
   '{"serverId": 575, "curServerId": 575}');
-- A late reading from before the newest move: cannot be placed, ignored.
select pg_temp.board('00000000-0000-4000-8000-0000000320b1', 580, 580, '2027-05-08T00:00:00Z', 'b1-late');

-- Unseen: first ever sighting is already on 580.
select pg_temp.board('00000000-0000-4000-8000-0000000320b2', 580, 580, '2027-05-02T00:00:00Z', 'b2-1');

-- Fallback: on 580, then a board that named no server and so read as 571.
select pg_temp.board('00000000-0000-4000-8000-0000000320b3', 580, 580, '2027-05-02T00:00:00Z', 'b3-1');
select pg_temp.board('00000000-0000-4000-8000-0000000320b3', 571, null, '2027-05-05T00:00:00Z', 'b3-2');

-- Torn: two boards in one batch, at one instant, disagree. (Two separate
-- batches would be a move and then a reading no later than it.)
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, power, raw)
values
  (gen_random_uuid(), 'cross.server.rank', 't', 'sm:b4-1', '2027-05-02T00:00:00Z',
   '00000000-0000-4000-8000-0000000320c1', 580, '00000000-0000-4000-8000-0000000320b4', 580,
   98320003000571, 4000, '{"serverId": 580}'),
  (gen_random_uuid(), 'cross.server.rank', 't', 'sm:b4-2', '2027-05-02T00:00:00Z',
   '00000000-0000-4000-8000-0000000320c1', 581, '00000000-0000-4000-8000-0000000320b4', 581,
   98320003000571, 4000, '{"serverId": 581}');

-- Stayer: home twice.
select pg_temp.board('00000000-0000-4000-8000-0000000320b5', 571, 571, '2027-05-01T00:00:00Z', 'b5-1');
select pg_temp.board('00000000-0000-4000-8000-0000000320b5', 571, 571, '2027-05-06T00:00:00Z', 'b5-2');

-- Homecomer: away to 580, then back home, in one batch through the recorder
-- (the backfill's path).
select internal.record_server_sightings(
  array['00000000-0000-4000-8000-0000000320b6', '00000000-0000-4000-8000-0000000320b6',
        '00000000-0000-4000-8000-0000000320b6']::uuid[],
  array[580, 580, 571],
  array['2027-05-02T00:00:00Z', '2027-05-03T00:00:00Z', '2027-05-09T00:00:00Z']::timestamptz[],
  array['server.rank', 'server.rank', 'server.rank']);

-- ---------------------------------------------------------------------------
-- What was written (as the owner, past RLS).

select results_eq(
  $$ select from_server_id, to_server_id, seen_at, last_seen_from_at, source_command
       from public.player_server_moves
      where player_id = '00000000-0000-4000-8000-0000000320b1' order by seen_at $$,
  $$ values (571, 580, '2027-05-03T00:00:00Z'::timestamptz, '2027-05-01T00:00:00Z'::timestamptz, 'cross.server.rank'),
            (580, 575, '2027-05-10T00:00:00Z'::timestamptz, '2027-05-04T00:00:00Z'::timestamptz, 'al.rank') $$,
  'Hopper: home to 580 from a board, 580 to 575 from a roster; the late 580 reading adds nothing');

select results_eq(
  $$ select from_server_id, to_server_id, last_seen_from_at
       from public.player_server_moves
      where player_id = '00000000-0000-4000-8000-0000000320b2' $$,
  $$ values (571, 580, null::timestamptz) $$,
  'Unseen: first sighting away from home is a move from the uid''s server, never seen there');

select results_eq(
  $$ select from_server_id, to_server_id from public.player_server_moves
      where player_id = '00000000-0000-4000-8000-0000000320b3' $$,
  $$ values (571, 580) $$,
  'Fallback: a board that named no server is not a move back home');

select is_empty(
  $$ select 1 from public.player_server_moves where player_id = '00000000-0000-4000-8000-0000000320b4' $$,
  'Torn: two readings at one instant that disagree say nothing');

select is_empty(
  $$ select 1 from public.player_server_moves where player_id = '00000000-0000-4000-8000-0000000320b5' $$,
  'Stayer: never left, no move');

select results_eq(
  $$ select from_server_id, to_server_id, seen_at, last_seen_from_at
       from public.player_server_moves
      where player_id = '00000000-0000-4000-8000-0000000320b6' order by seen_at $$,
  $$ values (571, 580, '2027-05-02T00:00:00Z'::timestamptz, null::timestamptz),
            (580, 571, '2027-05-09T00:00:00Z'::timestamptz, null::timestamptz) $$,
  'Homecomer: away and back are two moves (no snapshot rows, so no last-seen)');

-- Replaying the same sightings writes nothing new.
select internal.record_server_sightings(
  array['00000000-0000-4000-8000-0000000320b6', '00000000-0000-4000-8000-0000000320b6']::uuid[],
  array[580, 571],
  array['2027-05-02T00:00:00Z', '2027-05-09T00:00:00Z']::timestamptz[],
  array['server.rank', 'server.rank']);
select is((select count(*)::int from public.player_server_moves
            where player_id = '00000000-0000-4000-8000-0000000320b6'), 2,
  'a replay of sightings already recorded adds no move');

-- A failing recorder must not fail the snapshot insert. Make it fail with a
-- constraint every new move breaks (not valid: the rows already here stay).
alter table public.player_server_moves
  add constraint sm_test_break check (seen_at < '2000-01-01') not valid;
select lives_ok(
  $$ select pg_temp.board('00000000-0000-4000-8000-0000000320b5', 582, 582, '2027-05-20T00:00:00Z', 'b5-break') $$,
  'a failing recorder does not fail the snapshot insert');
select is((select count(*)::int from public.player_snapshots where idempotency_key = 'sm:b5-break'), 1,
  'the snapshot landed');
alter table public.player_server_moves drop constraint sm_test_break;

-- ---------------------------------------------------------------------------
-- Who reads.

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000320f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sm-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000320f2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sm-community@test.invalid'),
  ('00000000-0000-4000-8000-0000000320f3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sm-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000320f1', 'member', 'member'),
  ('00000000-0000-4000-8000-0000000320f2', 'community', 'community'),
  ('00000000-0000-4000-8000-0000000320f3', 'viewer', 'viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

select pg_temp.act_as('00000000-0000-4000-8000-0000000320f1');
select is((select count(*)::int from public.player_server_moves
            where player_id::text like '00000000-0000-4000-8000-0000000320b%'), 6,
  'a member reads every move');

select results_eq(
  $$ select direction, game_uid, home_server, other_server_id, player_name
       from public.server_migration_flow(580)
      where game_uid::text like '9832%' order by seen_at, game_uid $$,
  $$ values ('in'::text,  98320001000571::bigint, 571, 571, 'Unseen'::text),
            ('in'::text,  98320002000571::bigint, 571, 571, 'Fallback'::text),
            ('in'::text,  98320005000571::bigint, 571, 571, 'Homecomer'::text),
            ('in'::text,  98320000000571::bigint, 571, 571, 'Hopper'::text),
            ('out'::text, 98320005000571::bigint, 571, 571, 'Homecomer'::text),
            ('out'::text, 98320000000571::bigint, 571, 575, 'Hopper'::text) $$,
  'server 580: four arrivals from 571, Homecomer back to 571, Hopper on to 575');

select results_eq(
  $$ select direction, alliance_code from public.server_migration_flow(575)
      where game_uid::text like '9832%' $$,
  $$ values ('in'::text, 'OVR'::text) $$,
  'server 575: Hopper arrived, with the alliance the roster put them in');

select is((select count(*)::int from public.server_migration_flow(580, '2027-05-05T00:00:00Z')
            where game_uid::text like '9832%'), 2,
  'p_since keeps only the moves first seen from then on');

select results_eq(
  $$ select server_id, arrived, departed from public.server_migration_summary()
      where server_id in (571, 575, 580) order by server_id $$,
  $$ values (571, 1::bigint, 4::bigint), (575, 1::bigint, 0::bigint), (580, 4::bigint, 2::bigint) $$,
  'summary counts people each way per server');

select pg_temp.act_as('00000000-0000-4000-8000-0000000320f2');
select is((select count(*)::int from public.player_server_moves
            where player_id::text like '00000000-0000-4000-8000-0000000320b%'), 6,
  'community reads the moves, as it reads players');

select pg_temp.act_as('00000000-0000-4000-8000-0000000320f3');
select is_empty(
  $$ select 1 from public.player_server_moves $$,
  'a viewer reads no move');
select is_empty(
  $$ select 1 from public.server_migration_flow(580) $$,
  'a viewer gets no row from the per-server read');

reset role;
set local role anon;
select throws_ok(
  $$ select 1 from public.player_server_moves $$,
  '42501', null, 'anon cannot read the table');
select throws_ok(
  $$ select 1 from public.server_migration_summary() $$,
  '42501', null, 'anon cannot call the summary');

reset role;
set local role authenticated;
select throws_ok(
  $$ select internal.record_server_sightings(null, null, null, null) $$,
  '42501', null, 'an API caller cannot call the recorder');

reset role;
select * from finish();
rollback;
