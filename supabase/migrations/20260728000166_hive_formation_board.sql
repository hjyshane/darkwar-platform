-- 0166: the formation as a list of instructions — one row per slot, carrying
-- the coordinate a member is actually told to teleport to.
--
-- THE ABSOLUTE COORDINATE IS COMPUTED HERE AND NOWHERE ELSE. 0165 stores
-- offsets so a formation can be moved without redrawing it, which means the
-- number a member reads off their screen exists only as anchor + offset. Doing
-- that addition in the browser would put the one figure this whole feature
-- delivers behind a client-side sum, and a stale anchor in a cache would send
-- eighty people to the wrong ground. One place, server-side, next to the rows
-- it is computed from.
--
-- ONE ROW PER SLOT, WHICH IS ONE ROW PER PERSON. The repo's rule about screens
-- that count people applies exactly: PostgREST caps at 1,000 rows and ignores
-- a bigger limit, so a row-per-detail shape drops whole members in silence.
-- Every join below is either to a primary key or an EXISTS, so the row count
-- is the slot count and cannot grow behind anyone's back.
--
-- WHY THE NAME COMES FROM `players` AND MEMBERSHIP FROM THE ROSTER. They are
-- two different questions and the repo has a standing rule about the second.
-- `players` is keyed on player_id, so joining it for a name and a power cannot
-- duplicate a slot. But "is this person still in the alliance" must not be
-- read from `players.current_alliance_id` — that column is a LAST KNOWN
-- alliance that nothing ever clears, so it says yes for everybody who ever
-- joined. `still_a_member` asks `alliance_roster_latest` instead, as an
-- EXISTS so it stays one row per slot.
--
-- That flag is not decoration. A formation drawn a fortnight ago holds
-- assignments for people who have since left, and an officer reading the
-- board has no other way to see it — the name is still there, the tile is
-- still theirs, and nobody is coming to stand on it.

create view public.hive_formation_board
with (security_invoker = true) as
select
  s.slot_id,
  s.formation_id,
  f.name as formation_name,
  f.server_id,
  f.is_active,
  f.anchor_x,
  f.anchor_y,
  s.dx,
  s.dy,

  -- The instruction. Everything else on this row is context for it.
  f.anchor_x + s.dx as x,
  f.anchor_y + s.dy as y,
  -- The game's own packing of the pair, x * 1000 + y, as 0137 established
  -- from the map payload. Here so a row can be matched against a sighting
  -- without unpacking anything — and bigint, like the column it is compared
  -- against, so the comparison does not go through a cast the planner has to
  -- guess at.
  ((f.anchor_x + s.dx)::bigint * 1000 + (f.anchor_y + s.dy)) as point_id,

  s.ordinal,
  s.label,
  s.player_id,
  p.game_uid,
  p.current_name as player_name,
  p.hq_level,
  p.power,
  -- Null when the slot is empty, which reads as "nobody has left yet"
  -- rather than as a departure.
  case
    when s.player_id is null then null
    else exists (
      select 1
      from public.alliance_roster_latest r
      join public.alliances a on a.alliance_id = r.alliance_id
      where a.is_own
        and r.player_id = s.player_id
    )
  end as still_a_member,
  s.assigned_at,
  s.assigned_by,
  s.created_at,
  s.updated_at
from public.hive_formation_slots s
join public.hive_formations f on f.formation_id = s.formation_id
left join public.players p on p.player_id = s.player_id;

comment on view public.hive_formation_board is
  'One row per slot, with the absolute tile a member is told to teleport to. '
  'The addition of anchor and offset happens here so no client can do it '
  'against a stale anchor.';

grant select on public.hive_formation_board to authenticated;

-- The map's own sightings, cut to a box, so a formation can be drawn over
-- ground somebody is already standing on.
--
-- WITHOUT THIS THE EDITOR IS BLIND. A hive move is planned onto ground that
-- looks empty on a picture of the whole world and is not: a stranger's base
-- inside the shape means one member arrives to find the tile taken, and the
-- formation is crooked from the first teleport. `latest_world_cities` (0144)
-- already answers "where is each base now"; what it cannot do through
-- PostgREST is answer it for a RECTANGLE without the client sending four
-- filters and hoping the planner uses the box index.
--
-- A function rather than a view because the box is an argument. Marked stable
-- and reading the member-gated view as the CALLER, so it hands out nothing
-- the reader could not already select.
--
-- The bound is what a screen can draw. An editor window is tens of tiles on a
-- side; a box big enough to matter for the cap is a box nobody is looking at.
create function public.world_cities_in_box(
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
  select w.game_uid, w.player_id, w.name, w.x, w.y, w.hq_level, w.captured_at
  from public.latest_world_cities w
  where w.server_id = p_server_id
    and w.x between least(p_x_min, p_x_max) and greatest(p_x_min, p_x_max)
    and w.y between least(p_y_min, p_y_max) and greatest(p_y_min, p_y_max)
  order by w.x, w.y
  limit 4000
$$;

comment on function public.world_cities_in_box(int, int, int, int, int) is
  'Newest sighting of every base inside a rectangle, for drawing a formation '
  'over ground that is already occupied. security invoker: the underlying '
  'view is member-gated and stays that way.';

grant execute on function public.world_cities_in_box(int, int, int, int, int)
  to authenticated;
