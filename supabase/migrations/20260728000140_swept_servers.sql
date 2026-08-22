-- 0140: which servers have been swept, and how recently.
--
-- The map tab lists the ground somebody has actually read. Doing that in the
-- client meant selecting raw tiles and reducing them in the browser, and that
-- is not merely slow — IT IS WRONG. `world_city_snapshots` grows by
-- observation: one pass over 581 wrote 2,440 rows and a re-scan writes them
-- all again, so the table is already past 450,000. Any client-side reduction
-- needs a limit, an ordered limit takes the NEWEST rows, and a server swept
-- last week then left alone falls off the end of that window entirely. The
-- tab would quietly stop offering a server that has perfectly good data.
--
-- An aggregate cannot be expressed through PostgREST without something to
-- select from, so it lives here: one row per server, a handful of rows total,
-- and no limit to get wrong.
--
-- security_invoker, like member_roster and member_season_buildings: the
-- underlying table is already gated by its own policy (0137), so the view
-- needs no gate of its own and a viewer gets nothing without one being
-- written. This is also why there is no `grant` to anon below.

-- The aggregate scans by server. The hot index in 0137 leads with server_id
-- for the box queries; this adds captured_at so `max()` per server is read
-- off the index rather than by touching every row of the group.
create index if not exists world_city_server_captured_idx
  on public.world_city_snapshots (server_id, captured_at desc);

create view public.swept_servers
with (security_invoker = true) as
select
  w.server_id,
  count(*) as tiles,
  -- The last time this ground was READ, which is what dates every position
  -- taken from it. Not the last time a player there moved.
  max(w.captured_at) as swept_at,
  count(distinct w.game_uid) as players
from public.world_city_snapshots w
group by w.server_id;

comment on view public.swept_servers is
  'Servers with any observed tile: how many, and when last read. Feeds the map tab''s server list.';

grant select on public.swept_servers to authenticated;
