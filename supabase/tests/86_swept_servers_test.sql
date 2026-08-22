-- 0140/0141: the swept-server list is one row per server, carries the last
-- read, shows a viewer nothing, and never aggregates over the tile table.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select has_column('public', 'swept_servers', c.col, 'swept_servers has ' || c.col)
from unnest(array['server_id', 'swept_at']) as c(col);

-- 0141 removed these two. `players` was a distinct-uid count nothing on the
-- screen ever consumed, and it could not be answered from the index at all;
-- `tiles` was decoration beside the sweep time. Between them they made every
-- visit to the map tab read all 450,000 rows, and the tab timed out.
select hasnt_column('public', 'swept_servers', 'players',
  'the unused distinct-uid count is gone');
select hasnt_column('public', 'swept_servers', 'tiles',
  'the tile count is gone: it was the last thing forcing a full read');

-- One row per server. The whole reason this view exists is that the client
-- cannot aggregate without a limit, and a limit drops servers.
select is(
  (select count(*)::int
     from (select server_id from public.swept_servers group by 1 having count(*) > 1) dupes),
  0,
  'one row per server');

-- The index every lookup in the view descends. Without it the skip scan
-- degrades into the sequential scan the view exists to avoid.
select has_index('public', 'world_city_snapshots', 'world_city_server_captured_idx',
  'server_id + captured_at index exists for the skip scan');

-- NO AGGREGATE OVER THE TILE TABLE, asserted on the definition rather than on
-- a query plan. A plan-shape test cannot say anything here: this table is
-- empty in a fresh database, where a sequential scan is the correct choice,
-- and pgTAP's own rolled-back runs bloat the indexes enough to move plans
-- around anyway. What actually caused the timeout was an aggregate in the
-- view, and that is a fact about its text.
select is(
  position('count(' in lower(pg_get_viewdef('public.swept_servers'::regclass)))::int,
  0,
  'the view definition contains no aggregate over the tile table');

-- The search's index. A leading-wildcard ilike cannot use a btree, so without
-- this a mistyped name reads every tile on that server before answering "no"
-- - the same timeout as the server list, one step later.
select has_index('public', 'world_city_snapshots', 'world_city_name_trgm_idx',
  'trigram index exists for the name search');

-- security_invoker, so a viewer is stopped by world_city_snapshots' own
-- policy (0137) rather than by anything written here. A tile carries a
-- player's coordinates; a reader with no member role must get none of it.
set local role authenticated;
select is_empty(
  $$ select server_id from public.swept_servers $$,
  'a request with no member role reads no swept servers');
reset role;

select * from finish();
rollback;
