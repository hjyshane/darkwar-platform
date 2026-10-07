-- 0242: seasons and their buildings are data, not code.
--
-- Asked for on 2026-10-07: when a new season starts, name its buildings in
-- settings and have it behave like Season 2 and 3 do, instead of a code change
-- and a deploy. Until now a season was four hard-coded things: the start date in
-- the dashboard (SEASON_START), the same date in internal.duel_round_anchor()
-- here, the building list per season in buildings.ts, and the "Season 3" label.
--
--   * seasons: number, name, start and end. The CURRENT season is the latest one
--     whose start has passed, so adding Season 4 with a future start changes
--     nothing until that day.
--   * season_buildings: the game's building type ids per season with the names
--     somebody gave them, an order, a provisional flag (a guess, shown as such)
--     and an optional per-building stall time.
--   * season_unnamed_buildings(): the building types the sweeps have SEEN that
--     no season has named. The names are not on the wire (only ids, 857000 ...),
--     so this is how a new season's ids reach the settings screen: sweep first,
--     then name what turned up.
--   * internal.duel_round_anchor() reads the current season's start (falling back
--     to 2026-08-17 02:00 UTC, Season 3's, if the table has nothing yet). Duel
--     rounds are four game weeks counted from the season start, so a new season
--     restarts them. Rounds already derived are kept. If a season starts MID-
--     round (not a multiple of 28 days from the last anchor), the new rounds'
--     weeks overlap the old grid and derive_duel_round (0184) re-derives those
--     weeks under the new boundaries, replacing the derived rows for them: that
--     is the game's own rule (rounds restart with the season), but it is the
--     one place this migration can change figures already on screen.
--
-- Seasons are shared by every alliance: they are facts about the game, like the
-- hero catalogue, so writing needs catalogue.write.

create table public.seasons (
  season_id int primary key check (season_id > 0),
  name text not null check (length(btrim(name)) between 1 and 40),
  -- The first game day's start (02:00 UTC). Null while a season's start is not
  -- known (Season 2's is not recorded), which keeps it out of "current".
  starts_at timestamptz,
  ends_at timestamptz,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

comment on table public.seasons is
  'The game''s seasons (0242). The current one is the latest whose start has '
  'passed. Written only through save_season.';

create table public.season_buildings (
  season_id int not null references public.seasons (season_id) on delete cascade,
  -- The game''s own building type id, never translated (0138).
  building_type_id int not null check (building_type_id > 0),
  name text not null check (length(btrim(name)) between 1 and 60),
  sort_order int not null default 0,
  -- A name that is a guess, shown as one.
  provisional boolean not null default false,
  -- Hours a level may sit unchanged before the board calls it stalled; null is
  -- the board's default.
  stall_hours int check (stall_hours is null or stall_hours > 0),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (season_id, building_type_id)
);

comment on table public.season_buildings is
  'The buildings of each season with their names and order (0242). Written only '
  'through save_season_building / delete_season_building.';

alter table public.seasons enable row level security;
alter table public.season_buildings enable row level security;
revoke all on public.seasons, public.season_buildings from anon, authenticated;
grant select on public.seasons, public.season_buildings to authenticated;
grant all on public.seasons, public.season_buildings to service_role;

create policy member_read on public.seasons
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
create policy member_read on public.season_buildings
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

-- ---------------------------------------------------------------------------
-- Seeded from what the code held, so nothing on screen changes.

insert into public.seasons (season_id, name, starts_at) values
  (2, 'Season 2', null),
  (3, 'Season 3', '2026-08-17 02:00:00+00');

-- Season 3, in the order the alliance reads them (buildings.ts).
insert into public.season_buildings (season_id, building_type_id, name, sort_order) values
  (3, 862000, 'Thermal Lab', 10),
  (3, 857000, 'Smart Green House 1', 20),
  (3, 858000, 'Smart Green House 2', 30),
  (3, 859000, 'Smart Green House 3', 40),
  (3, 860000, 'Smart Green House 4', 50),
  (3, 861000, 'Smart Green House 5', 60),
  (3, 863000, 'Strategic Barrack', 70),
  (3, 864000, 'Armed Turret 1', 80),
  (3, 866000, 'Armed Turret 2', 90),
  (3, 865000, 'Defensive Base 1', 100),
  (3, 867000, 'Defensive Base 2', 110);

-- Season 2: names read from the data's shape, every one a guess.
insert into public.season_buildings (season_id, building_type_id, name, sort_order, provisional) values
  (2, 743000, 'Obelisk', 10, true),
  (2, 851000, 'Altar 1', 20, true),
  (2, 852000, 'Altar 2', 30, true),
  (2, 853000, 'Altar 3', 40, true),
  (2, 854000, 'Altar 4', 50, true),
  (2, 855000, 'Altar 5', 60, true),
  (2, 856000, 'Barrack', 70, true),
  (2, 744000, 'Attack 1', 80, true),
  (2, 745000, 'Attack 2', 90, true),
  (2, 751000, 'Defense 1', 100, true),
  (2, 752000, 'Defense 2', 110, true);

-- ---------------------------------------------------------------------------
-- Writing.

create function public.save_season(
  p_season_id int,
  p_name text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.has_permission('catalogue.write') then
    raise exception 'editing seasons requires the catalogue.write permission'
      using errcode = '42501';
  end if;
  if p_season_id is null or p_season_id < 1 then
    raise exception 'a season number is 1 or more' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 40 then
    raise exception 'a season name is 1 to 40 characters' using errcode = '22023';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'a season ends after it starts' using errcode = '22023';
  end if;

  insert into public.seasons (season_id, name, starts_at, ends_at)
  values (p_season_id, v_name, p_starts_at, p_ends_at)
  on conflict (season_id) do update
    set name = excluded.name,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        updated_by = (select auth.uid()),
        updated_at = now();
end;
$$;

revoke all on function public.save_season(int, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.save_season(int, text, timestamptz, timestamptz) to authenticated;

create function public.save_season_building(
  p_season_id int,
  p_building_type_id int,
  p_name text,
  p_sort_order int default null,
  p_provisional boolean default false,
  p_stall_hours int default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.has_permission('catalogue.write') then
    raise exception 'editing season buildings requires the catalogue.write permission'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.seasons where season_id = p_season_id) then
    raise exception 'there is no season %', p_season_id using errcode = '22023';
  end if;
  if p_building_type_id is null or p_building_type_id < 1 then
    raise exception 'a building type id is a positive number' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'a building name is 1 to 60 characters' using errcode = '22023';
  end if;
  if p_stall_hours is not null and p_stall_hours < 1 then
    raise exception 'stall hours are 1 or more' using errcode = '22023';
  end if;

  insert into public.season_buildings
    (season_id, building_type_id, name, sort_order, provisional, stall_hours)
  values (
    p_season_id, p_building_type_id, v_name,
    coalesce(p_sort_order,
             (select coalesce(max(b.sort_order), 0) + 10
                from public.season_buildings b where b.season_id = p_season_id)),
    coalesce(p_provisional, false), p_stall_hours)
  on conflict (season_id, building_type_id) do update
    set name = excluded.name,
        sort_order = coalesce(p_sort_order, public.season_buildings.sort_order),
        provisional = excluded.provisional,
        stall_hours = excluded.stall_hours,
        updated_by = (select auth.uid()),
        updated_at = now();
end;
$$;

revoke all on function public.save_season_building(int, int, text, int, boolean, int)
  from public, anon;
grant execute on function public.save_season_building(int, int, text, int, boolean, int)
  to authenticated;

create function public.delete_season_building(p_season_id int, p_building_type_id int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('catalogue.write') then
    raise exception 'editing season buildings requires the catalogue.write permission'
      using errcode = '42501';
  end if;
  -- Only the NAME goes. The sightings stay, and the type shows up again under
  -- "seen, not named" until somebody names it.
  delete from public.season_buildings
   where season_id = p_season_id and building_type_id = p_building_type_id;
end;
$$;

revoke all on function public.delete_season_building(int, int) from public, anon;
grant execute on function public.delete_season_building(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Which building types the sweeps have seen that nobody has named.
--
-- From player_season_buildings_current (one row per player, the board's own
-- fold, 0154), not from the snapshots: a few hundred rows against hundreds of
-- thousands. A type is "seen" when some player currently has a level for it.

create function public.season_unnamed_buildings()
returns table (building_type_id int, players int, newest_seen timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select k.type_id::int, count(*)::int, max(c.newest_seen)
    from public.player_season_buildings_current c
   cross join lateral jsonb_object_keys(c.levels) as k(type_id)
   where not exists (
     select 1 from public.season_buildings b where b.building_type_id = k.type_id::int
   )
   group by k.type_id
   order by k.type_id::int;
$$;

revoke all on function public.season_unnamed_buildings() from public, anon;
grant execute on function public.season_unnamed_buildings() to authenticated;

comment on function public.season_unnamed_buildings() is
  'Building types some player has a level for that no season has named (0242). '
  'Names are not on the wire, so a new season''s ids arrive through the sweeps '
  'and are named in settings.';

-- ---------------------------------------------------------------------------
-- Duel rounds count from the current season's start.

create or replace function internal.duel_round_anchor()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select s.starts_at from public.seasons s
      where s.starts_at is not null and s.starts_at <= now()
      order by s.starts_at desc limit 1),
    timestamptz '2026-08-17 02:00:00+00')
$$;

comment on function internal.duel_round_anchor() is
  'Start of a known duel round: the current season''s start (seasons, 0242), or '
  'Season 3''s if there is none. Rounds are four game weeks back to back from '
  'here; see 0184.';
