-- 0144: one row per player per server, at the newest sighting.
--
-- Every map query wants "where is each base now", and world_city_snapshots
-- answers a different question: it holds one row per SIGHTING, and a sweep
-- writes a row for every tile it passes. A base the collector goes by often
-- has hundreds.
--
-- Reducing that in the browser needs a row limit, and A ROW LIMIT DROPS
-- PLAYERS. Ordered by captured_at the newest sightings win, so a player seen
-- once, a while ago, falls off the end and vanishes from the answer entirely
-- — not shown late or shown stale, but absent. That is the same failure the
-- swept-server list had in 0140, one level down, and it gets worse as the
-- filter widens: "HQ 38" is a few hundred rows, "HQ 31 and up" is tens of
-- thousands.
--
-- `distinct on (server_id, game_uid)` does it server-side, so what comes back
-- is players rather than sightings and a limit means what a reader expects.
--
-- Keyed on game_uid rather than player_id: a player outside the alliance has
-- no player_id, and keying on that would fold every stranger on the server
-- into one null-keyed row.
--
-- security_invoker, like member_roster and swept_servers: the underlying
-- table is already member-gated by its own policy (0137), so the view needs
-- no gate of its own.

-- The index the distinct-on reads in order. Without it this sorts the whole
-- table on every call.
create index if not exists world_city_server_uid_idx
  on public.world_city_snapshots (server_id, game_uid, captured_at desc);

create view public.latest_world_cities
with (security_invoker = true) as
select distinct on (w.server_id, w.game_uid)
  w.server_id,
  w.game_uid,
  w.player_id,
  w.name,
  w.x,
  w.y,
  w.point_id,
  w.hq_level,
  w.captured_at
from public.world_city_snapshots w
order by w.server_id, w.game_uid, w.captured_at desc;

comment on view public.latest_world_cities is
  'Newest sighting per player per server. One row per base, so a filter''s limit counts players rather than pans.';

grant select on public.latest_world_cities to authenticated;
