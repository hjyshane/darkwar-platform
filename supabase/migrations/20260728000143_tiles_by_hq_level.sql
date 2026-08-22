-- 0143: find every base on a server at a given HQ level.
--
-- A base that is destroyed, or whose shield finally drops, is teleported
-- somewhere random. The last sighting we hold is then a place the player is
-- no longer at, and no amount of waiting fixes it: a sweep only records the
-- ground it passed over, so if the base landed outside that ground it simply
-- has no newer row. The position is not wrong because the parser is wrong —
-- it is the last true thing we saw.
--
-- What you CAN do is search by something that survived the move. HQ level is
-- the obvious one, and the tile carries it, so "show me every HQ 38 on 581"
-- turns an unknown position into a list short enough to read.
--
-- HQ LEVEL DOES NOT MARK A KIND OF THING. It runs continuously from 1 to 45
-- across 19,720 observed tiles with no cluster that separates one sort of
-- structure from another; 38 alone has 629. This is a filter on a player
-- statistic, not a way to select towers as a category.
--
-- The index exists because the query without it is the one that already took
-- the map tab down. Filtering `server_id = X and hq_level = N` with only the
-- (server_id, captured_at) index means reading every tile that server has,
-- and 581 alone holds six figures.
--
-- captured_at trails the key so the newest-per-player reduction reads in
-- order rather than sorting what it finds.
create index if not exists world_city_server_hq_idx
  on public.world_city_snapshots (server_id, hq_level, captured_at desc)
  where hq_level is not null;
