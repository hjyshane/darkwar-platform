-- 0137: city tiles follow the snapshot conventions, stay member-only, and
-- keep the coordinate consistent with its packed form.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

select has_column('public', 'world_city_snapshots', c.col,
  'world_city_snapshots has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'world_city_snapshots', 'idempotency_key',
  'city tile idempotency_key is unique');

create function pg_temp.tile(key text, srv int, uid bigint, pid bigint, hq int)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid,
     point_id, x, y, name, hq_level)
  values
    ('00000000-0000-4000-8000-00000000f601', 'world.get.new', 'test',
     key, '2026-08-21T09:25:00Z', '00000000-0000-4000-8000-000000000c01', 580, srv,
     uid, pid, pid / 1000, pid % 1000, 'Ranger', hq);
$$;

select pg_temp.tile('t:wct:1', 580, 1327205044000580, 491444, 35);
select pg_temp.tile('t:wct:2', 584, 1327205044000584, 610381, 29);

select is((select count(*)::int from public.world_city_snapshots
           where idempotency_key like 't:wct:%'), 2,
  'city tiles land from more than one server');

-- The coordinate and its packed form must agree, or a map query by box and
-- a lookup by point_id describe different places.
select is((select count(*)::int from public.world_city_snapshots
           where idempotency_key like 't:wct:%'
             and point_id = x::bigint * 1000 + y), 2,
  'x and y stay consistent with point_id');

select is((select hq_level from public.world_city_snapshots
           where idempotency_key = 't:wct:1'), 35,
  'the tile keeps the HQ level it carried');

-- player_id is resolved cloud-side; a tile must land before it is known.
select is((select player_id from public.world_city_snapshots
           where idempotency_key = 't:wct:1'), null::uuid,
  'a city tile lands without a resolved player_id');

-- The same guard the season boards have: the map reaches servers outside the
-- tracked group, and the FK is what forces sync to register them untracked.
select throws_ok($$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, point_id, x, y)
  values
    ('00000000-0000-4000-8000-00000000f602', 'world.get.new', 'test',
     't:wct:3', '2026-08-21T09:25:00Z', '00000000-0000-4000-8000-000000000c01',
     580, 9999, 1327205044009999, 1, 0, 1)
$$, '23503', null, 'a city tile naming an unregistered server is refused');

-- 0065: a map of where every player lives must not be readable signed out.
set local role anon;
select throws_ok($$ select snapshot_id from public.world_city_snapshots $$,
  '42501', null, 'anon reads no city tiles');
reset role;

select * from finish();
rollback;
