-- 0246: a season's buildings are named from the game's own data.
--
-- 0242 said building names are not on the wire, which is true of the SERVER's
-- responses (only ids: 857000 ...). But the importer has been reading the
-- client's data tables since 0201, and game_upgrade_steps already holds a name
-- for every building type the client knows - including ones for seasons that
-- have not started (868000 Mineral Factory I ... 878000 Guardian Gem II are in
-- the client now). So the names do not have to be typed:
--
--   * season_unnamed_buildings() also returns `game_name`, the client's name
--     for that type (null when the client has none), so Settings can offer it.
--   * name_unnamed_season_buildings(season) names every seen-but-unnamed type
--     that has a game name, in one call, after the season's last building.
--     Types the client has no name for are left for a person.
--   * Season 2's buildings were guessed from the data's shape and marked
--     provisional. The client's names are better than the guesses, so those
--     (and only those) are replaced; a name somebody confirmed is never touched.
--
-- The game's name for a type is the same at every level, but min() keeps the
-- answer deterministic if a patch ever renames one.

drop function public.season_unnamed_buildings();

create function public.season_unnamed_buildings()
returns table (building_type_id int, players int, newest_seen timestamptz, game_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select k.type_id::int,
         count(*)::int,
         max(c.newest_seen),
         (select min(g.name)
            from public.game_upgrade_steps g
           where g.kind = 'building' and g.subject_id = k.type_id)
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
  'Building types some player has a level for that no season has named, with '
  'the client''s own name for each where it has one (0242, 0246).';

create function public.name_unnamed_season_buildings(p_season_id int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_named int;
begin
  if not public.has_permission('catalogue.write') then
    raise exception 'editing season buildings requires the catalogue.write permission'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.seasons where season_id = p_season_id) then
    raise exception 'there is no season %', p_season_id using errcode = '22023';
  end if;

  with todo as (
    select u.building_type_id, left(btrim(u.game_name), 60) as name,
           row_number() over (order by u.building_type_id) as n
      from public.season_unnamed_buildings() u
     where u.game_name is not null and btrim(u.game_name) <> ''
  ),
  ins as (
    insert into public.season_buildings (season_id, building_type_id, name, sort_order)
    select p_season_id, t.building_type_id, t.name,
           (select coalesce(max(b.sort_order), 0)
              from public.season_buildings b where b.season_id = p_season_id) + t.n * 10
      from todo t
    on conflict (season_id, building_type_id) do nothing
    returning 1
  )
  select count(*)::int into v_named from ins;
  return v_named;
end;
$$;

revoke all on function public.name_unnamed_season_buildings(int) from public, anon;
grant execute on function public.name_unnamed_season_buildings(int) to authenticated;

comment on function public.name_unnamed_season_buildings(int) is
  'Names every seen-but-unnamed building type that the client has a name for, '
  'into the given season, and returns how many (0246).';

-- Season 2's guesses, replaced by the client's names where it has them.
update public.season_buildings b
   set name = left(btrim(g.name), 60),
       provisional = false,
       updated_at = now()
  from (select subject_id, min(name) as name
          from public.game_upgrade_steps
         where kind = 'building'
         group by subject_id) g
 where b.provisional
   and g.subject_id = b.building_type_id::text
   and g.name is not null and btrim(g.name) <> '';
