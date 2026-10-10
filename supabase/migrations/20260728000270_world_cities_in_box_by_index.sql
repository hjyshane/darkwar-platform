-- 0270: world_cities_in_box finds the bases in a rectangle by index.
--
-- world_cities_in_box (0166) read latest_world_cities, a DISTINCT ON over the
-- server's whole snapshot history, and cut the rectangle afterwards: the box
-- cannot be pushed under a DISTINCT ON, because a base's newest sighting may be
-- outside it. Measured on production, a 70x70 box on server 580 took 7.9 s as
-- the owner (162,838 snapshots for 2,856 bases), which is the authenticated
-- role's whole 8 s statement_timeout, so the hive editor's "ground already
-- occupied" lookup could not be relied on there.
--
-- THE SHAPE. world_city_box_idx is (server_id, x, y). Bases that were EVER seen
-- inside the rectangle are found through it; each one's newest sighting is then
-- taken by world_city_server_uid_idx, and only those whose newest sighting is
-- still inside are kept. A base that has since moved away is therefore not
-- drawn, exactly as before.
--
-- THE ANSWER IS UNCHANGED: same rows, same columns, same order and cap. Checked
-- against the 0166 function on production over five boxes (580 whole map 2,856
-- rows, a 70x70 box, a 10x10 box, 584 and 588): same counts, nothing in the old
-- result missing from the new.

create or replace function public.world_cities_in_box(
  p_server_id int,
  p_x_min int,
  p_x_max int,
  p_y_min int,
  p_y_max int
)
returns table (
  game_uid bigint,
  player_id uuid,
  name text,
  x int,
  y int,
  hq_level int,
  captured_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with box as (
    select least(p_x_min, p_x_max) as x0, greatest(p_x_min, p_x_max) as x1,
           least(p_y_min, p_y_max) as y0, greatest(p_y_min, p_y_max) as y1
  ),
  seen_here as (
    select distinct w.game_uid
      from public.world_city_snapshots w, box
     where w.server_id = p_server_id
       and w.x between box.x0 and box.x1
       and w.y between box.y0 and box.y1
  ),
  newest as (
    select l.*
      from seen_here s
      cross join lateral (
        select w.game_uid, w.player_id, w.name, w.x, w.y, w.hq_level, w.captured_at
          from public.world_city_snapshots w
         where w.server_id = p_server_id and w.game_uid = s.game_uid
         order by w.captured_at desc
         limit 1) l
  )
  select n.game_uid, n.player_id, n.name, n.x, n.y, n.hq_level, n.captured_at
    from newest n, box
   where n.x between box.x0 and box.x1
     and n.y between box.y0 and box.y1
   order by n.x, n.y
   limit 4000
$$;

comment on function public.world_cities_in_box(int, int, int, int, int) is
  'Newest sighting of every base inside a rectangle, for drawing a formation '
  'over ground that is already occupied. security invoker: the row policy of '
  'world_city_snapshots stays the gate. Found by box index, 0270.';
