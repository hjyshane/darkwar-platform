-- 0299: retention keeps the newest migration power of every player.
--
-- The daily purge (0258) removes other players' component readings after 7 days. That
-- includes `migrate_power`, so the migration power read for a candidate on one day was
-- gone a week later and the Candidates column went blank, although nothing newer had
-- been read to replace it. The figure is fixed by the game at one moment, so the last
-- reading stays the answer however old it is.
--
-- The rule now spares the NEWEST migrate_power row per player; the readings it replaced
-- are purged as before. Applies to both entry points that share the rule, `retention_purge`
-- (the daily job) and `retention_report`. Same signatures, so grants and the job are
-- untouched. Rows already purged are not here to be spared: they come back by replaying
-- the collector's journal (docs/runbooks/retention.md).

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
    ['player_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    -- The newest migrate_power reading of every player is kept however old: the figure
    -- is fixed by the game at one moment, so the reading from weeks ago is still the
    -- answer, and a strange player's is not read again until they are looked at. Only
    -- the readings it superseded are history.
    ['player_component_power_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'
     || ' and not (metric = ''migrate_power'' and not exists ('
     || ' select 1 from public.player_component_power_snapshots n'
     || ' where n.player_id = player_component_power_snapshots.player_id'
     || ' and n.metric = ''migrate_power'''
     || ' and n.captured_at > player_component_power_snapshots.captured_at))'],
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


create or replace function public.retention_report(
  p_confirm boolean default false,
  p_keep_ours interval default interval '3 months',
  p_keep_others interval default interval '7 days'
)
returns table (relation text, rows bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Each table's rule, written ONCE. The count and the delete run the same
  -- text, so a report cannot describe a different set of rows from the one
  -- that gets removed — which is the whole reason this is not two functions.
  --
  -- Dynamic SQL, reluctantly, and the reason it is safe here: every relation
  -- name and predicate below is a literal in this migration, none of it comes
  -- from a caller, and the only parameters are the two cutoffs, passed with
  -- USING rather than interpolated. `%I` quotes the identifier regardless.
  v_rules text[][] := array[
    ['player_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    -- The newest migrate_power reading of every player is kept however old: the figure
    -- is fixed by the game at one moment, so the reading from weeks ago is still the
    -- answer, and a strange player's is not read again until they are looked at. Only
    -- the readings it superseded are history.
    ['player_component_power_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'
     || ' and not (metric = ''migrate_power'' and not exists ('
     || ' select 1 from public.player_component_power_snapshots n'
     || ' where n.player_id = player_component_power_snapshots.player_id'
     || ' and n.metric = ''migrate_power'''
     || ' and n.captured_at > player_component_power_snapshots.captured_at))'],
    ['player_detail_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    -- Our own alliance's roster history is what 0067 derives departures from,
    -- so it keeps the long window whoever each row is about.
    ['alliance_member_snapshots',
     'captured_at < case when (select a.is_own from public.alliances a'
     || ' where a.alliance_id = alliance_member_snapshots.alliance_id)'
     || ' then $1 else $2 end'],
    -- One row per alliance per sweep rather than one per member: cheap to
    -- keep, and the only long series anyone has of another alliance's power.
    ['alliance_snapshots', 'captured_at < $1 and $2 is not null'],
    -- Whole boards, and only boards none of ours is on. arena_entries and
    -- arena_entry_heroes cascade from here, so the protection has to sit at
    -- this level: dropping a board would take our own member's lineup with it.
    ['arena_snapshots',
     'captured_at < $2 and $1 is not null and not exists ('
     || ' select 1 from public.arena_entries e'
     || ' where e.arena_snapshot_id = arena_snapshots.snapshot_id'
     || ' and e.player_id in (select player_id from public.own_player_ids))']
  ];
  v_ours timestamptz := now() - p_keep_ours;
  v_others timestamptz := now() - p_keep_others;
  v_relation text;
  v_predicate text;
  v_count bigint;
  i int;
begin
  if not public.has_permission('members.manage') then
    raise exception 'members.manage is required' using errcode = '42501';
  end if;

  for i in 1 .. array_length(v_rules, 1) loop
    v_relation := v_rules[i][1];
    v_predicate := v_rules[i][2];
    if p_confirm then
      execute format(
        'with removed as (delete from public.%I where %s returning 1) select count(*) from removed',
        v_relation, v_predicate
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


