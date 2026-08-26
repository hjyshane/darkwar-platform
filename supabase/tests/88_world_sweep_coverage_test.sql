-- 0148: coverage is a record of where the CAMERA looked, not of what it
-- found, and it is one row per server so a client limit counts servers.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- The camera, and the zoom. Without a centre the row cannot say what ground
-- it covered; without view_lvl a sweep that ran at the dead zoom cannot be
-- told from one that worked.
select has_column('public', 'world_viewport_snapshots', c.col,
  'world_viewport_snapshots has ' || c.col)
from unnest(array['server_id', 'center_x', 'center_y', 'view_lvl',
                  'object_count', 'captured_at']) as c(col);

-- Every snapshot table carries this, and here it is what makes replay safe:
-- `renormalize` reruns journalled observations and must not duplicate a pan.
select col_is_unique('public', 'world_viewport_snapshots', 'idempotency_key',
  'a replayed pan does not duplicate its coverage row');

-- ONE ROW PER SERVER. 20 x 20 cells would be 400 rows per server, and
-- PostgREST caps a response at 1,000 while ignoring a larger limit — the
-- failure 0140, 0144 and 0147 each exist to fix.
select is(
  (select count(*)::int from (
     select server_id from public.world_sweep_coverage group by 1 having count(*) > 1
   ) dupes),
  0,
  'world_sweep_coverage is one row per server');

-- The cells live in jsonb precisely so the row count stays the server count.
select has_column('public', 'world_sweep_coverage', 'gaps',
  'uncovered cells are folded into a jsonb array, not spread over rows');
select has_column('public', 'world_sweep_coverage', 'seen_cells',
  'read cells and their times are folded into jsonb');

-- The half-extents are measured, and a caller has to be able to see which
-- figure was used rather than infer it from the view's text.
select is(
  (select half_x from public.world_viewport_half_extent()), 35,
  'half-width is the measured 35 tiles (71 across)');
select is(
  (select half_y from public.world_viewport_half_extent()), 70,
  'half-height is the measured 70 tiles (140 down)');

-- The box join descends this. Without it every coverage question is a full
-- scan of a table that grows by one row per pan forever.
select has_index('public', 'world_viewport_snapshots', 'world_viewport_box_idx',
  'server_id + centre index exists for the coverage join');

-- Same FK guard as the tile table: the map reaches servers outside the
-- tracked group, and the FK is what forces sync to register them untracked.
select throws_ok($$
  insert into public.world_viewport_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, center_x, center_y)
  values
    ('00000000-0000-4000-8000-00000000f801', 'world.get.new', 'test',
     't:wvs:1', '2026-08-25T17:00:00Z', '00000000-0000-4000-8000-000000000c01',
     580, 9999, 500, 500)
$$, '23503', null, 'a viewport naming an unregistered server is refused');

-- 0065, matching world_city_snapshots: where the collector has been looking
-- is not something to publish signed out.
set local role anon;
select throws_ok($$ select snapshot_id from public.world_viewport_snapshots $$,
  '42501', null, 'anon reads no viewports');
select throws_ok($$ select server_id from public.world_sweep_coverage $$,
  '42501', null, 'anon reads no coverage');
reset role;

select * from finish();
rollback;
