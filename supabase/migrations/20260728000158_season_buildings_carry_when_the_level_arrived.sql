-- 0158: when each building reached the level it is on, so a stall is visible.
--
-- The board shows what everyone has built. What it cannot show is who has
-- STOPPED, and that is the question the alliance actually asks between kill
-- days: a member sitting on the same level for two days is either done for the
-- week or gone.
--
-- A LEVEL AND A DATE ARE NOT ENOUGH. `newest_seen` is per player, not per
-- building, so it cannot say "we looked at this turret recently and it had not
-- moved". Absence of change and absence of observation look identical through
-- one timestamp, and this repo has now paid for that confusion three times
-- (unswept ground vs empty ground, 0148 most recently). So two facts are
-- stored per building rather than one:
--
--   level_since  when the CURRENT level was first observed
--   seen_at      when that building was last observed at all
--
-- A stall is then `seen_at` recent AND `level_since` old. A member the sweep
-- has not passed over in three days has an old `level_since` too, and the
-- reader can tell the difference because `seen_at` says so.
--
-- `level_since` IS EXACT WITHIN ITS WINDOW, and only because levels are
-- monotonic: 1,536 increases and zero decreases across 1,720 objects
-- re-observed on more than one day (protocol/worldmap.py records the count).
-- With no decreases, the earliest sighting at the current level IS the start
-- of the current run — there is no earlier run at that same level to confuse
-- it with. If a decrease is ever observed this becomes wrong rather than
-- imprecise, and the monotonicity test in the parser is what would catch it.
--
-- The window is 30 days, and it is a bound on WORK rather than on truth. This
-- function runs from a statement trigger on the collector's own writes, over a
-- table that grows by observation; searching a whole season's history for the
-- start of a run that began in week one would put that scan behind every map
-- sweep. A run older than the window yields null, which the reader shows as
-- "longer ago than we look" — the honest answer, and the one the question
-- ("has this moved in two days") cannot tell apart from any other old date.

alter table public.player_season_buildings_current
  add column if not exists level_since jsonb not null default '{}'::jsonb,
  add column if not exists seen_at jsonb not null default '{}'::jsonb;

comment on column public.player_season_buildings_current.level_since is
  'building_type_id (text) -> when the current level was first observed. Exact '
  'because levels never decrease, so the earliest sighting at the current '
  'level is the start of the current run.';

comment on column public.player_season_buildings_current.seen_at is
  'building_type_id (text) -> when that building was last observed. Paired '
  'with level_since so "has not moved" can be told apart from "has not been '
  'looked at".';


create or replace function public.refresh_player_season_buildings(p_players uuid[] default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  -- One timestamp per refresh, taken ONCE: clock_timestamp() advances per row
  -- when written inline, and the prune below would then eat everything except
  -- the last row written. 0106 paid for this lesson.
  v_ts timestamptz := clock_timestamp();
begin
  -- The lock guards the FULL refresh only. A targeted refresh must not skip:
  -- skipping would drop the batch that triggered it, and nothing would come
  -- back for those players until some later sweep happened to touch them
  -- again. Per-player upserts serialise on their own row anyway.
  if p_players is null
     and not pg_try_advisory_xact_lock(hashtext('player_season_buildings_refresh')) then
    return;
  end if;

  if not (
    public.is_service_request()
    or public.current_app_role() = any (array['member','officer','admin']::public.app_role[])
    or coalesce(current_setting('request.jwt.claims', true), '') = ''
  ) then
    return;
  end if;

  with newest as (
    -- Newest level per player per building type, straight off the index 0149
    -- added for exactly this key order. UNCHANGED FROM 0154 ON PURPOSE: this
    -- function runs from a statement trigger on the collector's own writes,
    -- and 0154 exists because computation in the wrong place timed this board
    -- out. The `level_since` join below is added beside it, not instead of it.
    select distinct on (b.player_id, b.building_type_id)
      b.player_id,
      b.building_type_id,
      b.level,
      b.game_uid,
      b.server_id,
      b.captured_at
    from public.season_building_snapshots b
    where b.player_id is not null
      -- A building whose type the parser could not read cannot become a JSON
      -- key, and a null key is an error rather than a missing column. It was
      -- never on the board; it is not on it now either.
      and b.building_type_id is not null
      and (p_players is null or b.player_id = any (p_players))
    order by b.player_id, b.building_type_id, b.captured_at desc
  ),
  since as (
    -- When the current level was first seen, over a BOUNDED window.
    --
    -- Unbounded, this would scan every sighting a player's buildings ever had
    -- — on a table that grows by observation, inside a trigger. The question
    -- being asked is "has this moved in the last day or two", and for that a
    -- run older than the window is simply old: the reader gets a null and
    -- treats it as "longer ago than we look", which is the honest answer
    -- rather than a wrong number.
    select
      n.player_id,
      n.building_type_id,
      min(b.captured_at) as level_since
    from newest n
    join public.season_building_snapshots b
      on b.player_id = n.player_id
     and b.building_type_id = n.building_type_id
     and b.level = n.level
     and b.captured_at >= v_ts - interval '30 days'
    group by n.player_id, n.building_type_id
  ),
  folded as (
    select
      n.player_id,
      min(n.game_uid) as game_uid,
      min(n.server_id) as server_id,
      jsonb_object_agg(n.building_type_id::text, n.level)
        filter (where n.level is not null) as levels,
      jsonb_object_agg(n.building_type_id::text, s.level_since)
        filter (where n.level is not null and s.level_since is not null) as level_since,
      jsonb_object_agg(n.building_type_id::text, n.captured_at)
        filter (where n.level is not null) as seen_at,
      -- The OLDEST sighting among this player's buildings: a row is only as
      -- fresh as its stalest cell, since one pan sees part of a plot.
      min(n.captured_at) as oldest_seen,
      max(n.captured_at) as newest_seen
    from newest n
    left join since s
      on s.player_id = n.player_id and s.building_type_id = n.building_type_id
    group by n.player_id
  )
  insert into public.player_season_buildings_current as t
    (player_id, game_uid, server_id, levels, level_since, seen_at,
     oldest_seen, newest_seen, refreshed_at)
  select
    f.player_id,
    f.game_uid,
    f.server_id,
    coalesce(f.levels, '{}'::jsonb),
    coalesce(f.level_since, '{}'::jsonb),
    coalesce(f.seen_at, '{}'::jsonb),
    f.oldest_seen,
    f.newest_seen,
    v_ts
  from folded f
  on conflict (player_id) do update set
    game_uid     = excluded.game_uid,
    server_id    = excluded.server_id,
    levels       = excluded.levels,
    level_since  = excluded.level_since,
    seen_at      = excluded.seen_at,
    oldest_seen  = excluded.oldest_seen,
    newest_seen  = excluded.newest_seen,
    refreshed_at = excluded.refreshed_at;

  -- Only a full refresh may prune, and only when it wrote something: a caller
  -- whose view of the snapshots is empty upserts nothing, finds no row
  -- carrying v_ts, and therefore deletes nothing. A targeted refresh never
  -- prunes, because every player it did not ask about is legitimately older.
  if p_players is null
     and exists (select 1 from public.player_season_buildings_current u
                  where u.refreshed_at = v_ts) then
    delete from public.player_season_buildings_current t
    where t.refreshed_at < v_ts;
  end if;
end;
$$;

comment on function public.refresh_player_season_buildings(uuid[]) is
  'Recomputes player_season_buildings_current from season_building_snapshots, '
  'including when each building reached its current level (0158). Incremental: '
  'a statement trigger passes the player_ids it just wrote.';

-- 0154 granted these; a create-or-replace keeps the ACL, but saying so beats
-- rediscovering it. Point-in-time grants are a trap this repo has hit.
revoke execute on function public.refresh_player_season_buildings(uuid[]) from public, anon;
grant execute on function public.refresh_player_season_buildings(uuid[])
  to authenticated, service_role;


create or replace view public.member_season_buildings_by_member
with (security_invoker = true) as
select
  c.player_id,
  p.current_name,
  c.game_uid,
  c.server_id,
  c.levels,
  c.oldest_seen,
  c.newest_seen,
  -- APPENDED, NOT INSERTED. `create or replace view` may add columns at the
  -- end and nothing else: putting these beside `levels`, where they belong by
  -- meaning, fails with "cannot change name of view column".
  c.level_since,
  c.seen_at
from public.player_season_buildings_current c
join public.member_roster_current r on r.player_id = c.player_id
join public.players p on p.player_id = c.player_id;

comment on view public.member_season_buildings_by_member is
  'One row per roster member: buildings folded into jsonb of type id -> level, '
  'plus level_since and seen_at so a stalled build can be told from ground '
  'nobody has swept (0158). Reads player_season_buildings_current, computed '
  'when the collector writes (0154), joined to the current roster so a '
  'departure drops off without a prune. One row per MEMBER because PostgREST '
  'caps responses at 1000 and ignores a larger limit.';

grant select on public.member_season_buildings_by_member to authenticated;

-- Backfill the two new columns for rows written before this migration.
select public.refresh_player_season_buildings();
