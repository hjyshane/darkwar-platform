-- 0138: members' season buildings follow the snapshot conventions and stay
-- member-only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column('public', 'season_building_snapshots', c.col,
  'season_building_snapshots has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'season_building_snapshots', 'idempotency_key',
  'season building idempotency_key is unique');

create function pg_temp.b(key text, obj bigint, lvl int, pid bigint)
returns void language sql as $$
  insert into public.season_building_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid,
     object_id, point_id, x, y, building_type_id, level)
  values
    ('00000000-0000-4000-8000-00000000f701', 'world.get.new', 'test',
     key, '2026-08-22T09:25:00Z', '00000000-0000-4000-8000-000000000c01', 580, 580,
     1327205044000580, obj, pid, pid / 1000, pid % 1000, 859000, lvl);
$$;

-- One building observed twice at two levels: the history the board reads.
select pg_temp.b('t:sb:1', 1405455261136733388, 12, 593383);
select pg_temp.b('t:sb:2', 1405455261136733388, 13, 593383);

select is((select count(*)::int from public.season_building_snapshots
           where idempotency_key like 't:sb:%'), 2,
  'one building keeps a row per observation');

select is((select max(level) from public.season_building_snapshots
           where object_id = 1405455261136733388), 13,
  'the newest level is readable for one building');

select is((select count(distinct object_id)::int from public.season_building_snapshots
           where idempotency_key like 't:sb:%'), 1,
  'both rows belong to the same building object');

select throws_ok($$
  insert into public.season_building_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, point_id, x, y)
  values
    ('00000000-0000-4000-8000-00000000f702', 'world.get.new', 'test',
     't:sb:3', '2026-08-22T09:25:00Z', '00000000-0000-4000-8000-000000000c01',
     580, 9999, 1327205044009999, 1, 0, 1)
$$, '23503', null, 'a building naming an unregistered server is refused');

set local role anon;
select throws_ok($$ select snapshot_id from public.season_building_snapshots $$,
  '42501', null, 'anon reads no season buildings');
reset role;

select * from finish();
rollback;
