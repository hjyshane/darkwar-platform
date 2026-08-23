-- 0145: repair the tiles 0142 could not have reached.
--
-- 0142 rewrote every stored coordinate from point_id at 21:47 UTC. The
-- collector went on writing the OLD packing until 22:08 — twenty-one more
-- minutes — because the decoder fix and the repair are two different things
-- and only one of them takes effect immediately.
--
-- The collector is an editable install driven by a long-lived loop: changing
-- worldmap.py changes nothing until the ingest process restarts, and it did
-- not restart until the machine was rebooted three quarters of an hour later.
-- So 2,536 rows (2,112 cities, 424 season buildings) were decoded with the
-- packing the fix had already replaced, and arrived after the repair had
-- finished looking. Their coordinates are each other's axes.
--
-- The journal shows the boundary exactly, with no overlap: every row stamped
-- parser_version 1.0.0 satisfies the old `x * 1000 + y`, every row stamped
-- 1.1.0 satisfies `y * 1000 + (x + 1)`, and the two windows do not touch.
-- That clean split is what makes this safe to redo rather than reason about.
--
-- IDEMPOTENT BY CONSTRUCTION. x and y are recomputed from point_id, which is
-- the raw value off the wire and never changes, so running this against an
-- already-correct row produces the same row. The predicate then narrows it to
-- rows that actually disagree, so a third run touches nothing at all — and
-- the same statement can be run again the next time this class of mistake
-- happens without anyone having to work out who is affected.
--
-- THE LESSON IS THE ORDERING: repair last. A data repair is only complete
-- once every writer has stopped producing the thing being repaired, and a
-- long-lived worker keeps producing it until it is restarted.

update public.world_city_snapshots
   set x = (point_id % 1000) - 1,
       y = point_id / 1000
 where point_id % 1000 <> 0
   and (x <> (point_id % 1000) - 1 or y <> point_id / 1000);

update public.season_building_snapshots
   set x = (point_id % 1000) - 1,
       y = point_id / 1000
 where point_id % 1000 <> 0
   and (x <> (point_id % 1000) - 1 or y <> point_id / 1000);
