-- 0264: the server group is 565-588.
--
-- 0002 seeded 577-584 as the tracked group. The group has grown to 24 servers;
-- 565-576 and 585-588 reached `servers` only because sync's ensure_servers()
-- registers any server it sees as server_group='unknown', is_tracked=false
-- (NFR-007) so the foreign keys resolve. That was the right default for a
-- stranger and is the wrong label for a member of the group.
--
-- What changes with is_tracked = true: world_sweep_coverage (0148) seeds its
-- grid from the tracked servers, so the sixteen new ones now appear on the map
-- coverage screen at 0% until they are swept - which is the state that view
-- exists to show. Nothing else reads the flag.
--
-- The group label moves for ALL 24, including the original eight: one group,
-- one name. Nothing matches on the old '577-584' string (grepped across
-- supabase/, services/ and apps/ on 2026-10-09).
--
-- Rows are inserted where missing so a database built from migrations (CI, a
-- fresh checkout) ends up with the same 24 servers as production. A server that
-- has been merged into another keeps its flags: merged_into_server_id is
-- history, not something this should overwrite.
insert into public.servers (server_id, server_group, is_tracked)
select s, '565-588', true
from generate_series(565, 588) as s
on conflict (server_id) do update
  set server_group = excluded.server_group,
      is_tracked   = excluded.is_tracked
  where public.servers.merged_into_server_id is null;
