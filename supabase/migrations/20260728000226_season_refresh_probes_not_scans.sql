-- 0226: the season board's refresh no longer times out the collector's sync.
--
-- player_season_buildings_refresh_insert (0154) refreshes every player a
-- season_building_snapshots insert names, in the same statement. Its
-- "newest level per building" step was a distinct-on over each player's whole
-- history: for one 1,000-row sync batch on prod (2026-10-04) it read 245,201
-- rows and sorted them on disk to keep 1,780 — 7.8 s of the hosted 8 s
-- statement_timeout. 1,181 inserts averaged 2.2 s and peaked at 8.0 s; 30,586
-- rows dead-lettered from 9/27, and only 53 players ever reached the board.
--
-- Now each (player, building type) is one index probe, the level-since date
-- is carried from the board when the level has not changed, and a full
-- refresh finds its players by skipping through the index. The same rows come
-- out: checked read-only on prod against the old query for 300 players, 873
-- rows, 0 differences. On the same batch: 9.7 s -> 1.4 s.
--
-- One deliberate difference: level_since is the first sighting AFTER the last
-- one at another level. 0158 took the first sighting at that level anywhere in
-- the window, so 5 -> 6 -> 5 dated the second 5 from the first.
--
-- Also: season_building_member_type_idx (0139) and
-- season_building_player_type_captured_idx (0149) are the same index. Every
-- insert paid for both; the 0139 one goes.

drop index if exists public.season_building_member_type_idx;

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
  v_players uuid[];
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

  -- Every player a full refresh covers, by skipping through the player
  -- index one distinct id at a time rather than reading every sighting.
  if p_players is null then
    with recursive pl as (
      (select b.player_id from public.season_building_snapshots b
        where b.player_id is not null order by b.player_id limit 1)
      union all
      select (select b.player_id from public.season_building_snapshots b
               where b.player_id > pl.player_id order by b.player_id limit 1)
      from pl where pl.player_id is not null
    )
    select array_agg(pl.player_id) into v_players from pl where pl.player_id is not null;
  else
    v_players := p_players;
  end if;

  with recursive types as (
    -- Each player's building types, one index probe per type (0226). The old
    -- distinct-on read every sighting the players ever had and sorted it:
    -- 245,201 rows to keep 1,780 for one 1,000-row sync batch, 7.8 s of an
    -- 8 s statement budget, and 30,586 batches dead-lettered on it.
    select u.player_id,
           (select min(b.building_type_id) from public.season_building_snapshots b
             where b.player_id = u.player_id and b.building_type_id is not null)
             as building_type_id
    from unnest(v_players) as u(player_id)
    union all
    select t.player_id,
           (select min(b.building_type_id) from public.season_building_snapshots b
             where b.player_id = t.player_id and b.building_type_id > t.building_type_id)
    from types t
    where t.building_type_id is not null
  ),
  newest as (
    -- The newest sighting per player per building type: one probe each on
    -- season_building_player_type_captured_idx (0149).
    select t.player_id, t.building_type_id, x.level, x.game_uid, x.server_id, x.captured_at
    from types t
    cross join lateral (
      select b.level, b.game_uid, b.server_id, b.captured_at
      from public.season_building_snapshots b
      where b.player_id = t.player_id and b.building_type_id = t.building_type_id
      order by b.captured_at desc
      limit 1
    ) x
    where t.building_type_id is not null
  ),
  since as (
    -- When the current level was first seen. The board already holds it for
    -- a level that has not changed since the last refresh, so most batches
    -- read nothing here. Otherwise: the sighting after the last one at a
    -- different level, over the same 30-day window 0158 bounded it to — a
    -- run older than that is "longer ago than we look", and stays null.
    select
      n.player_id,
      n.building_type_id,
      case
        when c.levels ->> n.building_type_id::text = n.level::text
         and c.level_since ? n.building_type_id::text
          then (c.level_since ->> n.building_type_id::text)::timestamptz
        else (
          select min(b.captured_at)
          from public.season_building_snapshots b
          where b.player_id = n.player_id
            and b.building_type_id = n.building_type_id
            and b.level = n.level
            and b.captured_at >= v_ts - interval '30 days'
            and b.captured_at > coalesce((
              select d.captured_at
              from public.season_building_snapshots d
              where d.player_id = n.player_id
                and d.building_type_id = n.building_type_id
                and d.level is distinct from n.level
                and d.captured_at >= v_ts - interval '30 days'
              order by d.captured_at desc
              limit 1
            ), '-infinity'::timestamptz)
        )
      end as level_since
    from newest n
    left join public.player_season_buildings_current c on c.player_id = n.player_id
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
  'a statement trigger passes the player_ids it just wrote. Index probes, not '
  'history scans (0226).';

revoke execute on function public.refresh_player_season_buildings(uuid[]) from public, anon;
grant execute on function public.refresh_player_season_buildings(uuid[])
  to authenticated, service_role;
