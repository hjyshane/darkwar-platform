-- 0140: the swept-server list is one row per server, carries the last read,
-- and shows a viewer nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select has_column('public', 'swept_servers', c.col, 'swept_servers has ' || c.col)
from unnest(array['server_id', 'tiles', 'swept_at', 'players']) as c(col);

-- One row per server. The whole reason this view exists is that the client
-- cannot aggregate without a limit, and a limit drops servers.
select is(
  (select count(*)::int
     from (select server_id from public.swept_servers group by 1 having count(*) > 1) dupes),
  0,
  'one row per server');

-- The index the aggregate reads. Without it max(captured_at) per server
-- touches every row of the group, and the group is the whole table.
select has_index('public', 'world_city_snapshots', 'world_city_server_captured_idx',
  'server_id + captured_at index exists for the aggregate');

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
