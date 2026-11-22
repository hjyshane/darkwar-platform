-- 0344: map_atlas's walk over the pre-0318 rows is an index, not a scan of the server.
--
-- 0269 asserted, in prose, that map_atlas costs what the server has in bases;
-- 0318 quietly broke that for one of its two walks and no test noticed,
-- because the answer never changed, only the cost. Asserting on the plan, as
-- 59 and 60 do: both probes of `uids_old` must land on the partial index.
-- Checked red: before the index the first probe is a Bitmap Heap Scan over
-- `server_id = 580` with `Filter: (map_server_id IS NULL)`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

select has_index('public', 'world_city_snapshots', 'world_city_old_rows_uid_idx',
  'the pre-0318 rows have an index of their own');

select ok(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'world_city_old_rows_uid_idx')
    like '%WHERE (map_server_id IS NULL)%',
  'and it holds only the rows with no map_server_id');

create function pg_temp.plan_for(sql text) returns text language plpgsql as $$
declare
  line text;
  out text := '';
begin
  for line in execute 'explain (costs off) ' || sql loop
    out := out || line || E'\n';
  end loop;
  return out;
end;
$$;

-- The first probe of uids_old, exactly as the function writes it.
select matches(
  pg_temp.plan_for($q$
    select w.game_uid
      from public.world_city_snapshots w
     where w.server_id = 580 and w.map_server_id is null
     order by w.game_uid
     limit 1
  $q$),
  'world_city_old_rows_uid_idx',
  'the first old row of a server is found through the partial index');

-- A recursive step: the next old row after a uid.
select matches(
  pg_temp.plan_for($q$
    select w.game_uid
      from public.world_city_snapshots w
     where w.server_id = 580 and w.map_server_id is null and w.game_uid > 100001000000580
     order by w.game_uid
     limit 1
  $q$),
  'world_city_old_rows_uid_idx',
  'and so is the next one after a given uid');

select doesnt_match(
  pg_temp.plan_for($q$
    select w.game_uid
      from public.world_city_snapshots w
     where w.server_id = 580 and w.map_server_id is null
     order by w.game_uid
     limit 1
  $q$),
  'Filter: \(map_server_id IS NULL\)',
  'the NULL is an index condition, never a filter over heap rows');

select * from finish();
rollback;
