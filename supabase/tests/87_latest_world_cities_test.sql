-- 0143/0144: one row per player per server, and the indexes the map's two
-- filters descend.
--
-- READ THE VACUOUS ONES FOR WHAT THEY ARE. `world_city_snapshots` is empty in
-- a fresh database, so "at most one row per key" passes whether or not the
-- view has a key at all, and `is_empty` passes whether or not a policy denies.
-- They are kept because they stop meaning nothing the moment this suite runs
-- somewhere with data. On an empty database the assertions that actually bite
-- are the ones about the view's DEFINITION and about the indexes, which is why
-- those are the specific ones here.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

select has_column('public', 'latest_world_cities', c.col,
  'latest_world_cities has ' || c.col)
from unnest(array['server_id', 'game_uid', 'x', 'y', 'hq_level', 'captured_at']) as c(col);

-- The property the view exists for. Against the raw table a query's limit
-- counts PANS - a base is written once per viewport that catches it - so a
-- player seen once, a while ago, falls off the end of an ordered limit and
-- disappears from the answer rather than merely arriving late.
select is(
  (select count(*)::int
     from (select server_id, game_uid
             from public.latest_world_cities
            group by 1, 2 having count(*) > 1) dupes),
  0,
  'one row per player per server');

-- KEYED ON game_uid, NOT player_id, and these two survive an empty table.
--
-- A player outside the alliance has no player_id; keying on it would fold
-- every stranger on the server into one null-keyed row, and a search for a
-- rival would return a single arbitrary base. The dedupe test above cannot
-- catch that with no rows to dedupe.
--
-- The clause is cut out of the rendered definition rather than matched whole,
-- so the assertion does not break on how Postgres chooses to alias the table.
select is(
  position('game_uid' in
    split_part(
      split_part(lower(pg_get_viewdef('public.latest_world_cities'::regclass)),
                 'distinct on (', 2),
      ')', 1)) > 0,
  true,
  'the distinct-on key includes game_uid');

select is(
  position('player_id' in
    split_part(
      split_part(lower(pg_get_viewdef('public.latest_world_cities'::regclass)),
                 'distinct on (', 2),
      ')', 1)) ,
  0,
  'the distinct-on key does NOT include player_id');

-- No aggregate, for the same reason 0141 removed the last one from
-- swept_servers: an aggregate over this table reads every row, and the map
-- tab died on exactly that.
select is(
  position('count(' in lower(pg_get_viewdef('public.latest_world_cities'::regclass))),
  0,
  'the view definition contains no aggregate over the tile table');

-- The index `distinct on` reads in order. Without it the view sorts the whole
-- table on every call.
select has_index('public', 'world_city_snapshots', 'world_city_server_uid_idx',
  'server_id + game_uid + captured_at index exists for the distinct-on');

-- 0143. The map filters `server_id = X and hq_level >= N` to find a base that
-- teleported; without this that reads every tile the server has, and 581
-- alone holds six figures.
select has_index('public', 'world_city_snapshots', 'world_city_server_hq_idx',
  'server_id + hq_level index exists for the HQ range filter');

-- The view must not be security_definer: that would hand every reader the
-- migration owner's rights and bypass 0137 entirely. Checked on the relation
-- rather than on behaviour, because behaviour needs rows to show it.
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'latest_world_cities'
      and c.reloptions::text like '%security_invoker=true%'),
  1,
  'the view is security_invoker, so 0137 still gates it');

-- No direct grant to anon. The whole map is member-only; a select privilege
-- here would be a way in that no policy was asked about.
select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'latest_world_cities'
      and grantee = 'anon'),
  0,
  'anon holds no privilege on the view');

-- security_invoker, so a viewer is stopped by world_city_snapshots' own
-- policy (0137) rather than by anything written here. A tile carries a
-- player's coordinates and their HQ level; a reader with no member role must
-- get none of it.
set local role authenticated;
select is_empty(
  $$ select server_id from public.latest_world_cities $$,
  'a request with no member role reads no cities');
select is_empty(
  $$ select game_uid from public.latest_world_cities where hq_level >= 30 $$,
  'nor any of them by HQ level');
reset role;

select * from finish();
rollback;
