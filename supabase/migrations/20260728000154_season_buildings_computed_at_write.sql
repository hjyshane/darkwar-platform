-- 0154: the season board stops computing at read time.
--
-- 0149 took the board from 5.6s to 0.19s measured as service_role, and the
-- member session still timed out. Every measurement available from outside the
-- database says the query is fast; the one path that matters is the one that
-- cannot be measured from here, and it is over the 8s statement timeout.
--
-- This is the fourth screen to end up here. 0106 (members), 0107 (alliance
-- ranking), and now this one: read-time computation on a micro instance, under
-- per-row RLS, where the planner's estimates collapse and it picks a shape that
-- re-runs the inner query per member (0105 measured exactly that — a view
-- recomputed 92 times inside a nested loop). Each time the cure was the same,
-- and each time it held: compute when the data ARRIVES, read an indexed table.
--
-- Rather than diagnose a plan we cannot see, this removes the planner's choice.
--
-- WHAT THE TABLE HOLDS IS EVERY PLAYER, NOT EVERY MEMBER. Membership is joined
-- live in the view, against `member_roster_current` — 82 rows, a primary-key
-- probe each. That keeps the two properties this board has already been fixed
-- for twice: the roster is the roster (0146), and it is the CURRENT roster, so
-- a departure needs no prune here and cannot leave a stale row behind (0149).
-- The table is then a pure function of `season_building_snapshots` and nothing
-- else, which is what makes the incremental refresh below correct.
--
-- REFRESH IS INCREMENTAL, unlike 0106's. A roster batch is one statement every
-- few minutes; a map sweep is hundreds of insert statements in a row, and a
-- full recompute on each would put the collector's own writes behind a
-- quarter-second of read-time work it does not need. The statement trigger
-- takes the player_ids from its transition table and recomputes THOSE players
-- from the snapshots — never merges the incoming rows into the stored jsonb,
-- so a replayed or out-of-order capture cannot overwrite a newer level with an
-- older one. The full recompute stays available (null argument) and is what
-- this migration ends with.
--
-- The 24,349 snapshot rows fold to 1,207 for the 82 members on the board:
-- eighteen buildings each, one row per member after the fold (0147).

create table public.player_season_buildings_current (
  player_id uuid primary key references public.players (player_id) on delete cascade,
  game_uid bigint not null,
  server_id int not null references public.servers (server_id),
  -- building_type_id (as text, because that is what a JSON key is) -> level.
  levels jsonb not null default '{}'::jsonb,
  -- The OLDEST sighting among this player's buildings: a row is only as fresh
  -- as its stalest cell, since one pan sees part of a plot.
  oldest_seen timestamptz,
  newest_seen timestamptz,
  refreshed_at timestamptz not null default now()
);

alter table public.player_season_buildings_current enable row level security;

-- The same audience the snapshots themselves have (0138). Nothing here is
-- derived from anything a member cannot already read.
create policy member_read on public.player_season_buildings_current
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

grant select on public.player_season_buildings_current to authenticated;
grant all on public.player_season_buildings_current to service_role;

-- NO MEMBER WRITE POLICY, unlike member_roster_current. That table needed one
-- because a member action (a rank rebuild) triggers its refresh. This one is
-- refreshed only by writes to season_building_snapshots, and only the collector
-- writes those, as service_role. A member never needs to write here, so they
-- may not.

create function public.refresh_player_season_buildings(p_players uuid[] default null)
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
    -- added for exactly this key order.
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
  folded as (
    select
      n.player_id,
      min(n.game_uid) as game_uid,
      min(n.server_id) as server_id,
      jsonb_object_agg(n.building_type_id::text, n.level)
        filter (where n.level is not null) as levels,
      min(n.captured_at) as oldest_seen,
      max(n.captured_at) as newest_seen
    from newest n
    group by n.player_id
  )
  insert into public.player_season_buildings_current as t
    (player_id, game_uid, server_id, levels, oldest_seen, newest_seen, refreshed_at)
  select
    f.player_id,
    f.game_uid,
    f.server_id,
    coalesce(f.levels, '{}'::jsonb),
    f.oldest_seen,
    f.newest_seen,
    v_ts
  from folded f
  on conflict (player_id) do update set
    game_uid     = excluded.game_uid,
    server_id    = excluded.server_id,
    levels       = excluded.levels,
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
  'Recomputes player_season_buildings_current from season_building_snapshots. '
  'With an array, only those players; with null, everyone, and then prunes '
  'players no longer present. Always recomputes from the snapshots rather than '
  'merging incoming rows, so a replayed or out-of-order capture cannot '
  'overwrite a newer level with an older one.';

revoke execute on function public.refresh_player_season_buildings(uuid[]) from public, anon;
grant execute on function public.refresh_player_season_buildings(uuid[])
  to authenticated, service_role;

create function public.player_season_buildings_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_players uuid[];
begin
  select array_agg(distinct n.player_id)
    into v_players
  from new_rows n
  where n.player_id is not null;

  -- A batch that named no player refreshes nothing. Passing the null through
  -- would call the FULL recompute, which is the expensive thing this trigger
  -- exists to avoid — and it would do it on every sweep statement that
  -- happened to see only unlinked uids.
  if v_players is null then
    return null;
  end if;

  perform public.refresh_player_season_buildings(v_players);
  return null;
end;
$$;

create trigger player_season_buildings_refresh_insert
  after insert on public.season_building_snapshots
  referencing new table as new_rows
  for each statement execute function public.player_season_buildings_refresh_on_write();

-- Updates too: a snapshot whose player_id is filled in later by a repair (0142
-- and 0145 are both that shape) belongs on the board from that moment, and an
-- insert-only trigger would never hear about it.
create trigger player_season_buildings_refresh_update
  after update on public.season_building_snapshots
  referencing new table as new_rows
  for each statement execute function public.player_season_buildings_refresh_on_write();

-- The board itself: the precomputed row, the CURRENT roster, and the player's
-- name live. Same name, same columns, same order as 0147, so the dashboard
-- needs no change and no rebuild.
create or replace view public.member_season_buildings_by_member
with (security_invoker = true) as
select
  c.player_id,
  p.current_name,
  c.game_uid,
  c.server_id,
  c.levels,
  c.oldest_seen,
  c.newest_seen
from public.player_season_buildings_current c
join public.member_roster_current r on r.player_id = c.player_id
join public.players p on p.player_id = c.player_id;

comment on view public.member_season_buildings_by_member is
  'One row per roster member, buildings folded into a jsonb of type id -> '
  'level. Reads player_season_buildings_current, computed when the collector '
  'writes (0154), joined to the current roster so a departure drops off '
  'without a prune. Exists so a client limit counts members rather than rows: '
  'PostgREST caps responses at 1000, and the per-building view exceeded that '
  'at 84 members.';

-- Fill it once. If the migration role sees no snapshots, the empty guard makes
-- this a no-op and the collector's next write fills the table.
select public.refresh_player_season_buildings();
