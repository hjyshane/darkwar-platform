-- 0302: shrink the database to what is read.
--
-- The hosted database is over its 8 GB allowance again. Rankings are group-wide and stay
-- as 0299 left them (history of a figure ages out after 7 days, its latest value never
-- does). Two kinds of data are not, and are cut harder:
--
--   MAP    `world_city_snapshots`: 24 hours of sightings and the newest of each base.
--          `world_truck_snapshots` and `world_viewport_snapshots`: only the newest of
--          each truck and each swept area, whatever its age - what the last scan showed.
--          Every server, ours included. Cities were 7 days; trucks and viewports were
--          never purged at all.
--   SHOP   `shop_listing_snapshots`, `shop_pack_snapshots`, `shop_pack_catalogs` of any
--          server other than 579 and 580: the newest reading of each stays, the rest goes
--          after 7 days. Our own two servers keep their history.
--
-- Events (Black Money, Capital Clash, boss damage, ...) are written from the collector's
-- own server and carry no other servers' rows to purge; `storage_report` below says what
-- is actually big before another table is added to the list.
--
-- `retention_purge` keeps its signature, so the daily job (0258) picks the new rules up
-- at its next run, in batches. Deleting does not return disk to the OS: see
-- docs/runbooks/retention.md "Reclaiming the space".

create or replace function public.retention_purge(
  p_confirm boolean default false,
  p_keep_ours interval default interval '3 months',
  p_keep_others interval default interval '7 days',
  p_batch int default 20000
)
returns table (relation text, rows bigint)
language plpgsql
set search_path = ''
as $$
declare
  -- Every name and predicate is a literal here; the cutoffs are bound with
  -- USING and the batch size is an int formatted with %s, so nothing a caller
  -- supplies is interpolated as SQL text (0070's argument, unchanged).
  v_rules text[][] := array[
    -- THE NEWEST ROW OF EVERY FIGURE STAYS (0299). A row is purged only when the same
    -- thing was read again later: the history of a figure is what ages out, never its
    -- latest value. Without this, a stranger last seen 8 days ago, or a figure the game
    -- stopped sending, vanished from every screen that shows "the latest" - the
    -- migration power of a candidate went blank a week after it was read.
    ['player_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'
     || ' and exists (select 1 from public.player_snapshots n where n.player_id = player_snapshots.player_id and n.source_command = player_snapshots.source_command'
     || ' and n.captured_at > player_snapshots.captured_at)'],
    ['player_component_power_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'
     || ' and exists (select 1 from public.player_component_power_snapshots n where n.player_id = player_component_power_snapshots.player_id and n.metric = player_component_power_snapshots.metric'
     || ' and n.captured_at > player_component_power_snapshots.captured_at)'],
    ['player_detail_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'
     || ' and exists (select 1 from public.player_detail_snapshots n where n.player_id = player_detail_snapshots.player_id'
     || ' and n.captured_at > player_detail_snapshots.captured_at)'],
    ['alliance_member_snapshots',
     'captured_at < case when (select a.is_own from public.alliances a'
     || ' where a.alliance_id = alliance_member_snapshots.alliance_id)'
     || ' then $1 else $2 end'
     || ' and exists (select 1 from public.alliance_member_snapshots n'
     || ' where n.game_uid = alliance_member_snapshots.game_uid'
     || ' and n.alliance_id = alliance_member_snapshots.alliance_id'
     || ' and n.captured_at > alliance_member_snapshots.captured_at)'],
    ['alliance_snapshots',
     'captured_at < $1 and $2 is not null'
     || ' and exists (select 1 from public.alliance_snapshots n'
     || ' where n.alliance_id = alliance_snapshots.alliance_id'
     || ' and n.captured_at > alliance_snapshots.captured_at)'],
    ['arena_snapshots',
     'captured_at < $2 and $1 is not null and not exists ('
     || ' select 1 from public.arena_entries e'
     || ' where e.arena_snapshot_id = arena_snapshots.snapshot_id'
     || ' and e.player_id in (select player_id from public.own_player_ids))'],
    -- THE MAP (0302). Bases keep a day of sightings and the newest of each. Trucks and
    -- swept areas keep ONLY the newest of each: what a scan showed last. The screens read
    -- the latest of each (`latest_world_cities`, the truck views read the last day, the
    -- sweep coverage reads the last time an area was swept); every sighting before it is
    -- history of where somebody WAS. Every server, ours included.
    ['world_city_snapshots',
     'captured_at < now() - interval ''24 hours'' and exists ('
     || ' select 1 from public.world_city_snapshots n'
     || ' where n.server_id = world_city_snapshots.server_id'
     || ' and n.game_uid = world_city_snapshots.game_uid'
     || ' and n.captured_at > world_city_snapshots.captured_at)'],
    ['world_truck_snapshots',
     'exists ('
     || ' select 1 from public.world_truck_snapshots n'
     || ' where n.server_id = world_truck_snapshots.server_id'
     || ' and n.truck_uuid = world_truck_snapshots.truck_uuid'
     || ' and n.captured_at > world_truck_snapshots.captured_at)'],
    ['world_viewport_snapshots',
     'exists ('
     || ' select 1 from public.world_viewport_snapshots n'
     || ' where n.server_id = world_viewport_snapshots.server_id'
     || ' and n.center_x = world_viewport_snapshots.center_x'
     || ' and n.center_y = world_viewport_snapshots.center_y'
     || ' and n.captured_at > world_viewport_snapshots.captured_at)'],
    -- THE SHOP, other servers (0302): what packs and listings were on sale is read for our
    -- own server and 579; rankings are group-wide, the market is not. For any other server
    -- the newest reading of each stays and the rest goes after the window.
    ['shop_listing_snapshots',
     'server_id not in (579, 580) and captured_at < $2 and exists ('
     || ' select 1 from public.shop_listing_snapshots n'
     || ' where n.server_id = shop_listing_snapshots.server_id'
     || ' and n.shop_type = shop_listing_snapshots.shop_type'
     || ' and n.listing_id = shop_listing_snapshots.listing_id'
     || ' and n.captured_at > shop_listing_snapshots.captured_at)'],
    ['shop_pack_snapshots',
     'server_id not in (579, 580) and captured_at < $2 and exists ('
     || ' select 1 from public.shop_pack_snapshots n'
     || ' where n.server_id = shop_pack_snapshots.server_id'
     || ' and n.pack_id = shop_pack_snapshots.pack_id'
     || ' and n.captured_at > shop_pack_snapshots.captured_at)'],
    ['shop_pack_catalogs',
     'server_id not in (579, 580) and captured_at < $2 and exists ('
     || ' select 1 from public.shop_pack_catalogs n'
     || ' where n.server_id = shop_pack_catalogs.server_id'
     || ' and n.captured_at > shop_pack_catalogs.captured_at)']
  ];
  v_ours timestamptz := now() - p_keep_ours;
  v_others timestamptz := now() - p_keep_others;
  v_relation text;
  v_predicate text;
  v_count bigint;
  i int;
begin
  if p_batch is null or p_batch < 1 then
    raise exception 'p_batch must be a positive integer';
  end if;

  for i in 1 .. array_length(v_rules, 1) loop
    v_relation := v_rules[i][1];
    v_predicate := v_rules[i][2];
    if p_confirm then
      -- ctid batching: the inner select is the same predicate, capped, so a
      -- call never removes more than p_batch rows from one table.
      execute format(
        'with removed as (delete from public.%I where ctid = any(array('
        || 'select ctid from public.%I where %s limit %s)) returning 1) '
        || 'select count(*) from removed',
        v_relation, v_relation, v_predicate, p_batch
      ) into v_count using v_ours, v_others;
    else
      execute format('select count(*) from public.%I where %s', v_relation, v_predicate)
        into v_count using v_ours, v_others;
    end if;
    if v_count > 0 then
      relation := v_relation;
      rows := v_count;
      return next;
    end if;
  end loop;
end;
$$;


-- What is big, without scanning anything: sizes from the catalog, rows are the planner's
-- estimate. Service role only, so it is called from the SQL editor or the CLI.
--
--   select * from public.storage_report();
--   select pg_size_pretty(pg_database_size(current_database()));
create function public.storage_report(p_limit int default 30)
returns table (
  relation text,
  total_bytes bigint,
  heap_bytes bigint,
  index_bytes bigint,
  toast_bytes bigint,
  est_rows bigint,
  total_pretty text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.relname::text,
         pg_total_relation_size(c.oid),
         pg_relation_size(c.oid),
         pg_indexes_size(c.oid),
         coalesce(pg_total_relation_size(c.reltoastrelid), 0),
         c.reltuples::bigint,
         pg_size_pretty(pg_total_relation_size(c.oid))
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by pg_total_relation_size(c.oid) desc
   limit greatest(p_limit, 1);
$$;

revoke all on function public.storage_report(int) from public, anon, authenticated;
grant execute on function public.storage_report(int) to service_role;

comment on function public.storage_report(int) is
  'The largest public tables with heap, index and TOAST sizes (0302). Service role only.';
