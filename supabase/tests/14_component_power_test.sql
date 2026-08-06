-- 0018: the component boards follow the snapshot conventions, keep the four
-- metrics apart, and refuse a metric nobody has verified.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select has_column('public', 'player_component_power_snapshots', c.col,
  'player_component_power_snapshots has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'player_component_power_snapshots', 'idempotency_key',
  'component power idempotency_key is unique');

create function pg_temp.board(key text, m text, btype int, p bigint, unit int)
returns void language sql as $$
  insert into public.player_component_power_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid,
     metric, power, rank, board_type, name, unit_id)
  values
    ('00000000-0000-4000-8000-00000000f401', 'rank.get.by.range', 'test',
     key, '2026-07-30T05:37:10Z', '00000000-0000-4000-8000-000000000c01', 580,
     578, 1327205044000578, m, p, 1, btype, 'Ranked001', unit);
$$;

-- One player, four boards, four different readings: they must coexist.
select pg_temp.board('t:cp:1', 'hero_power_total', 45, 109781050, null);
select pg_temp.board('t:cp:2', 'hero_power_best', 49, 11880950, 40002);
select pg_temp.board('t:cp:3', 'pet_power_total', 79, 18036787, null);
select pg_temp.board('t:cp:4', 'pet_power_best', 80, 8373780, 106);

-- Counted over THIS file's four rows, not over every reading the database
-- holds for that uid. 1327205044000578 is a real player, so a database with
-- real captures loaded already has readings for them and the absolute count
-- came out 12 — the same fault 21_announcements was fixed for.
select is((select count(*)::int from public.player_component_power_snapshots
           where idempotency_key like 't:cp:%'), 4,
  'one player holds all four component readings at once');

-- Scoped to this file's row for the same reason as the count above: the uid
-- is a real player, and a database with real captures holds their readings
-- too, so an unscoped subquery returns several and errors outright.
select is((select power from public.player_component_power_snapshots
           where metric = 'hero_power_total' and idempotency_key like 't:cp:%'),
  109781050::bigint, 'each metric keeps its own value');

-- The guard that matters: a metric nobody verified must not be storable.
--
-- 23503 (foreign key) rather than 23514 (check) since 0086. The guard is the same
-- and this test is still the one that proves it — what changed is where the list of
-- valid names lives. It was a CHECK constraint, so every new metric the game
-- started reporting needed a migration to edit it; it is now a row in
-- `component_metrics`, which also carries the metric's label and who may see it.
select throws_ok($$
  insert into public.player_component_power_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid,
     metric, power, board_type)
  values
    ('00000000-0000-4000-8000-00000000f402', 'rank.get.by.range', 'test',
     't:cp:5', '2026-07-30T05:37:10Z', '00000000-0000-4000-8000-000000000c01',
     580, 578, 1327205044000578, 'total_power', 999, 999)
$$, '23503', null, 'an unverified metric name is refused');

-- These boards are what every player already sees in the client.
set local role anon;
-- Was 'anon reads the component boards'. 0065 made every board member-only.
select throws_ok($$ select snapshot_id from public.player_component_power_snapshots $$,
  '42501', null, 'anon reads no component board');
reset role;

select * from finish();
rollback;
