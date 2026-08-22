-- 0142: every stored tile has its axes the wrong way round. Repair in place.
--
-- The packing is `y * 1000 + (x + 1)`. The decoder read it as `x * 1000 + y`,
-- which is wrong twice over: the two halves are swapped, and the column half
-- is one-based.
--
-- NOTHING ABOUT THIS LOOKED LIKE AN ERROR. A swapped pair is still a valid
-- square on the map, still moves when the base moves, and still reads as a
-- plausible coordinate — it is simply somebody else's ground. It surfaced
-- only because two members compared the dashboard against their own screen:
--
--   we said 515, 554   the game said 553, 515
--   we said 557, 547   the game said 546, 557
--
-- Both differ the same way, and 19,720 stored tiles agree: cities sit roughly
-- symmetrically about the middle of the map, so the two components should
-- span similar ranges, and instead `point_id % 1000` ran 2..998 against
-- `point_id // 1000` at 1..997 — the same off-by-one at both ends of one axis
-- only, which is what a one-based column looks like from outside.
--
-- REPAIRED RATHER THAN RE-INGESTED because point_id is stored raw. That is
-- the whole point of keeping the undecoded value beside the derived ones: a
-- parser bug in a derivation is arithmetic on a column, not a replay of every
-- capture file. Same reason `raw` exists on every snapshot table.
--
-- x is `(point_id % 1000) - 1` and can therefore be -1 for a point_id that is
-- an exact multiple of 1000. No such row exists today and the map filters
-- off-map tiles anyway, but the update leaves those alone rather than writing
-- a coordinate that is not a place.

update public.world_city_snapshots
   set x = (point_id % 1000) - 1,
       y = point_id / 1000
 where point_id % 1000 <> 0;

update public.season_building_snapshots
   set x = (point_id % 1000) - 1,
       y = point_id / 1000
 where point_id % 1000 <> 0;
