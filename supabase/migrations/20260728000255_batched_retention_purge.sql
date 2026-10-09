-- 0255: retention that can actually run against production, in batches.
--
-- WHY. On 2026-10-09 the hosted database was 10 GB against an 8 GB disk
-- allowance. 0070 built retention and nothing ever ran it, so the arithmetic of
-- "strangers keep 7 days" was never applied:
--
--   alliance_member_snapshots   2.41 M rows, 2.28 M of them (95%) other
--                               alliances' rows older than 7 days   (3.4 GB)
--   world_city_snapshots        1.34 M rows, 1.10 M older than 7 days (1.7 GB)
--   player_component_power_snapshots  0.69 M older than 7 days       (1.2 GB)
--   arena_entry_heroes          cascades from 1,661 boards older than 7 days
--                                                                      (1.5 GB)
--
-- Why not just call retention_report(true): it needs members.manage (a JWT, not
-- the service key), and it is ONE statement per table. Deleting 2.3 M rows in a
-- single statement holds the whole delete in WAL at once and runs into the API
-- statement timeout. This is the same predicate set, but it removes at most
-- p_batch rows per table per call and is meant to be called in a loop until
-- every count is zero.
--
-- WHAT IS NEW: world_city_snapshots. 0137 writes one row per SIGHTING, and
-- latest_world_cities (0144) reads only the newest per (server_id, game_uid),
-- so older sightings of a base that has a newer one are history nobody queries.
-- The rule keeps every row inside the window AND the newest sighting of every
-- base however old, so a player seen once last month still has a location.
-- swept_servers / world_sweep_coverage read the recent window, which is kept.
--
-- WHAT IS STILL NOT TOUCHED: the same list as 0070 (players, alliances,
-- player_names, anything scored), plus season_building_snapshots, whose
-- history feeds attendance scoring and has not been judged here.
--
-- DELETING DOES NOT SHRINK THE DISK. Postgres keeps freed pages inside the
-- table file, so pg_database_size stays at 10 GB until the tables are
-- rewritten: docs/runbooks/retention.md "Reclaiming the space".
--
-- Service-role only; counts by default, deletes only when told (the 0070 and
-- 0101 contract).
--
--   select * from public.retention_purge();                          -- count
--   select * from public.retention_purge(p_confirm := true);         -- one batch
create function public.retention_purge(
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
    ['player_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    ['player_component_power_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    ['player_detail_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    ['alliance_member_snapshots',
     'captured_at < case when (select a.is_own from public.alliances a'
     || ' where a.alliance_id = alliance_member_snapshots.alliance_id)'
     || ' then $1 else $2 end'],
    ['alliance_snapshots', 'captured_at < $1 and $2 is not null'],
    ['arena_snapshots',
     'captured_at < $2 and $1 is not null and not exists ('
     || ' select 1 from public.arena_entries e'
     || ' where e.arena_snapshot_id = arena_snapshots.snapshot_id'
     || ' and e.player_id in (select player_id from public.own_player_ids))'],
    -- Keep the window, and keep the newest sighting of every base.
    ['world_city_snapshots',
     'captured_at < $2 and $1 is not null and exists ('
     || ' select 1 from public.world_city_snapshots n'
     || ' where n.server_id = world_city_snapshots.server_id'
     || ' and n.game_uid = world_city_snapshots.game_uid'
     || ' and n.captured_at > world_city_snapshots.captured_at)']
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

comment on function public.retention_purge(boolean, interval, interval, int) is
  'retention_report (0070) in batches, plus world_city_snapshots: keeps the '
  'window and the newest sighting of every base. Counts unless p_confirm; '
  'with p_confirm removes at most p_batch rows per table per call, so loop '
  'until it returns no rows. Does not return disk to the OS - the tables '
  'must be rewritten afterwards. Service-role only.';

revoke execute on function public.retention_purge(boolean, interval, interval, int)
  from public, anon, authenticated;
grant execute on function public.retention_purge(boolean, interval, interval, int)
  to service_role;

-- 0006's blanket service_role grant predates this view (0070), and the function
-- runs as its caller, so without this the service key gets 42501 on it.
grant select on public.own_player_ids to service_role;
