-- 0344: map_atlas finds the pre-0318 rows by an index, not by reading every row the server ever had.
--
-- WHAT THE MAP SAID. "Could not load the map: map query failed: canceling
-- statement due to statement timeout", often, since the 8-hour sweeps of every
-- server began (2026-11-10) and more so after 0334 (11-18). The timeout is the
-- authenticated role's 8 s.
--
-- WHY. 0269 made map_atlas cost what the server has in BASES, not in
-- sightings: a loose index scan over (server_id, game_uid) walks one uid at a
-- time. 0318 split that walk in two, because a row written since then carries
-- the map it was seen on (map_server_id) and a row from before does not:
--
--   uids_new   where map_server_id = p          -> world_city_map_uid_captured_idx
--   uids_old   where server_id = p
--                and map_server_id is null       -> no index carries that NULL
--
-- No index has map_server_id beside server_id, so `map_server_id is null` is
-- a FILTER on heap rows, not an index condition, and a probe that must find
-- "the first old row after uid X" reads every newer row of every uid in
-- between from the heap until it finds one. The two shapes production can be
-- in, reproduced locally on 1.44M rows (8 servers x 3,000 bases x 60 sweeps),
-- as a member, in cache:
--
--   * No old rows at all for the server (renormalize filled map_server_id for
--     the journalled history): the FIRST probe of uids_old bitmap-scans every
--     row the server ever had - 180,000 rows, 7,579 heap pages - to return
--     nothing. 156 ms here, where the whole table sits in RAM; production's
--     world_city_snapshots is many times this and is read from disk under
--     the collector's writes.
--   * Some old rows under newer ones (500 of 3,000 uids): each of the 500
--     recursive steps walks about 2,880 heap rows before the next old row.
--     546 ms here.
--
-- Everything else in the function stays by index: uids_new and `latest` and
-- the "seen elsewhere since" check are one short probe per base (about 3,000
-- probes, 32,000 buffers, 58 ms after this change).
--
-- THE FIX. A partial index over exactly the rows uids_old reads:
--
--   (server_id, game_uid, captured_at desc) where map_server_id is null
--
-- It holds only pre-0318 rows, so it is small today and never grows (parser
-- >= 1.6.0 always writes map_server_id). The planner picks it for both probes
-- of uids_old - they become index-only scans - and when a server has no old
-- rows at all the first probe reads two index pages and is done. Same
-- numbers, same jsonb; the function body is unchanged. Locally: 156 -> 58 ms
-- and 546 -> 58 ms.
--
-- NOT MEASURED ON PRODUCTION. db-performance.md rule 1 says to EXPLAIN there
-- before calling it fixed; this session could not reach the hosted database.
-- The owner's check after `db push`: open the map as a member on a server with
-- many sweeps (580) a few times, cold; and
--   explain (analyze, buffers) select public.map_atlas(580);
-- should no longer show a Bitmap Heap Scan on world_city_snapshots with
-- `Filter: (map_server_id IS NULL)` under `CTE uids_old`.
--
-- LOCK. Plain `create index` (migrations run in one transaction, so not
-- CONCURRENTLY) takes a SHARE lock on world_city_snapshots for one pass over
-- the table: inserts from the sync worker wait for that pass and then
-- continue, as they did for 0318's index on the same table.

create index world_city_old_rows_uid_idx
  on public.world_city_snapshots (server_id, game_uid, captured_at desc)
  where map_server_id is null;

comment on index public.world_city_old_rows_uid_idx is
  'The rows written before 0318 (no map_server_id), in the order map_atlas''s uids_old walks them (0344). Nothing written since 0318 lands here, so it stays small.';
