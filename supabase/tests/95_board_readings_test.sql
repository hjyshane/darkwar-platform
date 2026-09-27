-- 0180: board readings are counted when written, a reading that arrives in
-- two batches is counted whole, and the view reports what 0153's lateral did.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- Two alliances on two servers; ids made up for this file.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values ('00000000-0000-4000-8000-0000000b8001', 580, 'b800000000000000000000000000000a', 'Home', 'HOM'),
       ('00000000-0000-4000-8000-0000000b8002', 581, 'b800000000000000000000000000000b', 'Away', 'AWY'),
       ('00000000-0000-4000-8000-0000000b8003', 580, 'b800000000000000000000000000000c', 'Next', 'NXT');

create function pg_temp.snap(obs text, key text, alliance text, srv int, ext text, rnk int)
returns void language sql as $$
  insert into public.alliance_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, alliance_id, server_id, external_id,
     name, code, power, rank)
  values (obs::uuid, 'alliance.rank', 'test', key, '2026-09-27T12:00:00Z',
          '00000000-0000-4000-8000-000000000c01', 580, alliance::uuid, srv, ext,
          'x', 'X', 1000, rnk);
$$;

-- A server-local reading: two rows, both on 580, in ONE statement.
select pg_temp.snap('00000000-0000-4000-8000-0000000b9001', 't:abr:1',
                    '00000000-0000-4000-8000-0000000b8001', 580,
                    'b800000000000000000000000000000a', 1);
select pg_temp.snap('00000000-0000-4000-8000-0000000b9001', 't:abr:2',
                    '00000000-0000-4000-8000-0000000b8003', 580,
                    'b800000000000000000000000000000c', 2);

-- A cross-server reading that arrives in TWO statements, the way sync splits
-- a board across batches of 100.
select pg_temp.snap('00000000-0000-4000-8000-0000000b9002', 't:abr:3',
                    '00000000-0000-4000-8000-0000000b8001', 580,
                    'b800000000000000000000000000000a', 2);
select is((select board_size from public.alliance_board_readings
            where observation_id = '00000000-0000-4000-8000-0000000b9002'), 1::bigint,
  'after the first batch the reading holds what has landed');

select pg_temp.snap('00000000-0000-4000-8000-0000000b9002', 't:abr:4',
                    '00000000-0000-4000-8000-0000000b8002', 581,
                    'b800000000000000000000000000000b', 1);

select is((select board_size from public.alliance_board_readings
            where observation_id = '00000000-0000-4000-8000-0000000b9002'), 2::bigint,
  'the second batch recounts the reading whole rather than replacing it');

select is((select board_scope from public.alliance_power_history
            where alliance_id = '00000000-0000-4000-8000-0000000b8001'
              and rank = 2), 'cross_server',
  'a reading that spans servers is a cross-server board once all of it has landed');

select is((select board_scope from public.alliance_power_history
            where alliance_id = '00000000-0000-4000-8000-0000000b8001'
              and rank = 1), 'server',
  'a reading on one server is a server board');

-- The view must report exactly what 0153's lateral computed, for every row on
-- the table — the seed's and this file's alike.
select bag_eq(
  $$ select alliance_id, captured_at, rank, board_size, board_scope
       from public.alliance_power_history $$,
  $$ select s.alliance_id, s.captured_at, s.rank, o.board_size,
            case when o.lo <> o.hi then 'cross_server' else 'server' end
       from public.alliance_snapshots s
       join public.alliances a on a.alliance_id = s.alliance_id
      cross join lateral (
        select count(*) as board_size, min(m.server_id) as lo, max(m.server_id) as hi
          from public.alliance_snapshots m
         where m.observation_id = s.observation_id) o $$,
  'every row of the view matches a direct count of its reading');

select is_empty($$
  select distinct s.observation_id from public.alliance_snapshots s
   where not exists (select 1 from public.alliance_board_readings r
                      where r.observation_id = s.observation_id) $$,
  'no reading on the table is missing its count');

-- Access: the same audience as alliance_snapshots.
set local role anon;
select throws_ok($$ select observation_id from public.alliance_board_readings $$,
  '42501', null, 'anon reads no board readings');
reset role;

set local role authenticated;
select is_empty($$ select observation_id from public.alliance_board_readings $$,
  'a signed-in request with no member role reads no board readings');
reset role;

-- The writer is service_role; a missing grant would pass everything above,
-- because pgTAP runs as the migration owner.
set local role service_role;
select lives_ok($$
  insert into public.alliance_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, alliance_id, server_id, external_id,
     name, code, power, rank)
  values ('00000000-0000-4000-8000-0000000b9003', 'alliance.rank', 'test', 't:abr:5',
          '2026-09-27T12:00:00Z', '00000000-0000-4000-8000-000000000c01', 580,
          '00000000-0000-4000-8000-0000000b8003', 580,
          'b800000000000000000000000000000c', 'z', 'Z', 1, 1)
$$, 'service_role can write a snapshot, and the trigger can count it');
reset role;

select * from finish();
rollback;
