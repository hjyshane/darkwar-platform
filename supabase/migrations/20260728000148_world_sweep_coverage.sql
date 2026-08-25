-- 0148: which ground has actually been READ, as opposed to which ground had
-- something on it.
--
-- WHY world_city_snapshots CANNOT ANSWER THIS. It stores cities. Snow,
-- wilderness, resource nodes and empty plots produce no row, so "no rows in
-- this region" means either "never swept" or "swept, and nobody lives there"
-- and nothing distinguishes them. A sweeper that treated absence as a gap
-- would re-walk the empty half of the map forever and still never learn it
-- was empty.
--
-- Coverage is a property of where the CAMERA looked, so that is what gets
-- stored: one row per `world.get.new` response. The response carries its own
-- `x`, `y`, `viewLvl` and `serverId`, so this needs no correlation with the
-- request and `renormalize` reconstructs it from observations already
-- journalled — the map does not have to be re-swept to get a coverage history.
--
-- ONE ROW PER PAN, not per tile: a sweep of a server is ~162 rows against the
-- ~2,400 city rows one pass writes.

create table public.world_viewport_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- THE MAP'S server, and here that really is the subject's server rather
  -- than the observation's. A viewport of 580's map contains players from
  -- eight servers, which is why world_city_snapshots derives each city's
  -- server from its uid; but the ground being looked at belongs to exactly
  -- one server, and the response says which in its own `serverId`.
  server_id int not null references public.servers (server_id),

  -- The camera. Verified against the decoded tiles: the response's x,y IS
  -- the centre of the returned window, median error 0.0 tiles over 72
  -- viewports, so no separate record of where the camera pointed is needed.
  center_x int not null,
  center_y int not null,

  -- 0 returns ~76 tiles, 1 returns ~647, and 2 returns NOTHING - 15 requests,
  -- zero points every time, while the game still draws a normal map. Stored
  -- because a sweep that ran at 2 would look successful and cover nothing,
  -- and this column is how that would be caught afterwards.
  view_lvl int,

  -- How many objects came back, and the box they fell in. NOT the covered
  -- region: `points` carries objects, not every tile, so in sparse ground
  -- this box is much smaller than what the camera actually saw. Kept so the
  -- half-extents the coverage view assumes can be audited against reality
  -- rather than trusted forever.
  object_count int not null default 0,
  min_x int,
  max_x int,
  min_y int,
  max_y int
);

create index world_viewport_server_captured_idx
  on public.world_viewport_snapshots (server_id, captured_at desc);
-- The coverage join is a box test against the centre.
create index world_viewport_box_idx
  on public.world_viewport_snapshots (server_id, center_x, center_y);

alter table public.world_viewport_snapshots enable row level security;

grant select on public.world_viewport_snapshots to authenticated;
grant all on public.world_viewport_snapshots to service_role;

-- Member-only, matching world_city_snapshots (0137, per 0065). Where the
-- collector has been looking is not something to publish signed out.
create policy member_read on public.world_viewport_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create trigger world_viewport_snapshots_notify
  after insert on public.world_viewport_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

comment on table public.world_viewport_snapshots is
  'One row per world.get.new response: where the camera looked, when, and at '
  'what zoom. Exists because city rows cannot distinguish unswept ground from '
  'empty ground.';

-- 0137''s comment describes the packing as `x * 1000 + y`, which is what the
-- decoder believed before the coordinate fix and is wrong in two ways at
-- once. Corrected here rather than by editing an applied migration.
comment on column public.world_city_snapshots.point_id is
  'The game''s own tile id, which IS the coordinate, packed y * 1000 + x + 1 '
  '- row first, column one-based. Kept alongside x and y so a row can be '
  'matched back to the payload that produced it. (0137 recorded this as '
  'x * 1000 + y; that was the pre-0142 misreading.)';


-- The covered region of one pan, as half-extents from the centre.
--
-- Measured from 47 viewLvl 1 responses decoded with the current decoder: the
-- X span was 71 in EVERY ONE - median, p90 and max alike - and Y was 140 or
-- 141. It is a fixed window the server chooses, not something that varies
-- with the screen, which is why single values are honest here.
--
-- Deliberately the measured figure and not a padded one. Claiming more than
-- was seen would mark ground swept that was not; claiming less would invent
-- gaps and make the sweeper walk them forever.
create function public.world_viewport_half_extent()
returns table (half_x int, half_y int)
language sql
immutable
parallel safe
set search_path = public
as $$ select 35, 70 $$;

comment on function public.world_viewport_half_extent is
  'Half-width and half-height in tiles of one viewLvl 1 viewport (71 x 140), '
  'measured over 47 responses. Used by world_sweep_coverage.';

-- The view below runs as its invoker, so the invoker needs this. A missing
-- EXECUTE is not a silent no-op: the ACL is checked whether or not the call
-- is reached, so the view would fail outright for exactly the role it is
-- granted to.
grant execute on function public.world_viewport_half_extent() to authenticated;
grant execute on function public.world_viewport_half_extent() to service_role;


-- Coverage of each server, ONE ROW PER SERVER.
--
-- The grid is 50-tile cells, so a 1000x1000 map is 20 x 20 = 400 cells. A
-- row per cell would be 400 per server and PostgREST caps a response at 1,000
-- rows while ignoring a larger limit - the failure this repo has now hit
-- three times (0140, 0144, 0147). Folding the cells into jsonb makes the row
-- count the SERVER count, which no cap can reach.
create view public.world_sweep_coverage
with (security_invoker = true) as
with extent as (
  select half_x, half_y from public.world_viewport_half_extent()
),
grid as (
  select
    s.server_id,
    gx.i * 50 as cell_x,
    gy.i * 50 as cell_y
  -- SEEDED FROM THE TRACKED SERVERS, not from the servers that happen to
  -- have viewports. Seeding from observations would make a server nobody has
  -- ever swept ABSENT rather than 0% covered, which is the one state most
  -- worth seeing — "not in the list" reads as "nothing to do here".
  from public.servers s
  cross join generate_series(0, 19) as gx (i)
  cross join generate_series(0, 19) as gy (i)
  where s.is_tracked
    and s.merged_into_server_id is null
),
seen as (
  select
    g.server_id,
    g.cell_x,
    g.cell_y,
    -- A cell counts as read when a pan's window covered its CENTRE. Cell
    -- centres rather than corners: a cell straddling the edge of a pan is
    -- half-read, and calling that covered is how a sweep reports success
    -- over ground it only clipped.
    max(v.captured_at) as seen_at
  from grid g
  cross join extent e
  left join public.world_viewport_snapshots v
    on v.server_id = g.server_id
   and v.object_count > 0
   and g.cell_x + 25 between v.center_x - e.half_x and v.center_x + e.half_x
   and g.cell_y + 25 between v.center_y - e.half_y and v.center_y + e.half_y
  group by g.server_id, g.cell_x, g.cell_y
)
select
  server_id,
  50                                                   as cell_size,
  count(*)::int                                        as cells_total,
  count(seen_at)::int                                  as cells_seen,
  (count(*) - count(seen_at))::int                     as cells_never_seen,
  min(seen_at)                                         as oldest_seen_at,
  max(seen_at)                                         as newest_seen_at,
  -- Every cell that has been read, and when. The caller decides what counts
  -- as stale; a view cannot take an interval and a fixed one here would be
  -- wrong for both a nightly sweep and a season-long one.
  coalesce(
    jsonb_object_agg(
      cell_x || ',' || cell_y, seen_at
    ) filter (where seen_at is not null),
    '{}'::jsonb
  )                                                    as seen_cells,
  -- Ground no pan has ever covered. This is the sweeper's work list.
  coalesce(
    jsonb_agg(
      jsonb_build_array(cell_x, cell_y) order by cell_y, cell_x
    ) filter (where seen_at is null),
    '[]'::jsonb
  )                                                    as gaps
from seen
group by server_id;

comment on view public.world_sweep_coverage is
  'One row per server: how much of its map has been read, when each 50-tile '
  'cell was last read (seen_cells), and which cells never have (gaps). One '
  'row per server rather than per cell so a client limit counts servers.';

grant select on public.world_sweep_coverage to authenticated;
