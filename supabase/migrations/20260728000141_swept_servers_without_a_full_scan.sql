-- 0141: swept_servers, without reading the whole table.
--
-- 0140 aggregated `group by server_id` over world_city_snapshots. On
-- production that is past 450,000 rows and the map tab died on it:
--
--   canceling statement due to statement timeout
--
-- Two things made it expensive, and only one of them was obvious.
--
-- `count(distinct game_uid)` cannot be answered from the index at all — it
-- has to fetch game_uid for every row — and NOTHING CONSUMED IT. A column
-- added because it seemed interesting cost a heap scan of the whole table on
-- every visit to the tab.
--
-- The rest was still O(rows): count(*) and max() per group walk every entry
-- in the index, and an index-only scan needs the visibility map to be current
-- to avoid the heap anyway — which is a bet on autovacuum for an
-- insert-only table that grows by observation and never stops.
--
-- So this stops counting. The screen needs two facts — which servers have
-- been read, and when each was last read — and both can be had in O(servers)
-- index lookups instead of O(rows):
--
--   * the distinct server ids come from a skip scan: take the lowest, then
--     repeatedly take the lowest above the last one. Each step is one index
--     descent, and there are as many steps as there are servers.
--   * the last sweep per server is `order by captured_at desc limit 1` on
--     the same (server_id, captured_at desc) index — one more descent each.
--
-- A dozen index lookups, whether the table holds 450,000 rows or 50 million.
--
-- WHAT IS LOST is the tile count the tab used to print. It was decoration —
-- "2,440 tiles read" beside "last swept 3 hours ago" — and it was the only
-- part that required looking at every row. The sweep time is the fact
-- somebody acts on; the count is not worth a full scan on every tab open.

-- THE SEARCH HAD THE SAME PROBLEM ONE STEP LATER. The tab looks a player up
-- with `name ilike '%term%'` inside one server, and an unindexed ilike has to
-- read every tile that server has before it can say "no such name" — which is
-- precisely the case somebody hits when they mistype. Fixing only the server
-- list would have moved the timeout from opening the tab to using it.
--
-- Trigram GIN, because a leading-wildcard ilike cannot use a btree at all.
-- The planner combines it with the server_id filter as a bitmap.
create extension if not exists pg_trgm with schema extensions;

-- Unqualified opclass, with the schema put on the path instead. `with schema`
-- is ignored when the extension already exists, so on a database where
-- pg_trgm was installed somewhere else `extensions.gin_trgm_ops` would not
-- resolve and this migration would fail on an environment difference rather
-- than on anything real.
set local search_path = public, extensions;

create index if not exists world_city_name_trgm_idx
  on public.world_city_snapshots
  using gin (name gin_trgm_ops);

reset search_path;

-- `create or replace view` cannot drop a column, so the view is replaced
-- outright. Nothing depends on it but the dashboard query.
drop view if exists public.swept_servers;

create view public.swept_servers
with (security_invoker = true) as
with recursive walk as (
  select (
    select w.server_id
      from public.world_city_snapshots w
     order by w.server_id
     limit 1
  ) as server_id
  union all
  select (
    select w.server_id
      from public.world_city_snapshots w
     where w.server_id > walk.server_id
     order by w.server_id
     limit 1
  )
  from walk
  where walk.server_id is not null
)
select
  walk.server_id,
  -- The last time this ground was READ, which is what dates every position
  -- taken from it. Not the last time a player there moved.
  (
    select w.captured_at
      from public.world_city_snapshots w
     where w.server_id = walk.server_id
     order by w.captured_at desc
     limit 1
  ) as swept_at
from walk
where walk.server_id is not null;

comment on view public.swept_servers is
  'Servers with any observed tile, and when each was last read. O(servers) index lookups, never a scan of the tile table.';

grant select on public.swept_servers to authenticated;
