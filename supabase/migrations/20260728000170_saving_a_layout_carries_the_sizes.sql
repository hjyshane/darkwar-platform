-- 0170: the whole-formation save learns that a tile has a size.
--
-- 0167 wrote the overlap pre-check as `abs(a.dx - b.dx) < 3`, which is the
-- 3x3 assumption in a second place. 0169 put the size on the row, so this has
-- to read it — otherwise the function's own message would go on describing a
-- clash by a rule the constraint no longer uses, and the two would disagree
-- about which layouts are legal.
--
-- Written as the same int4range intersection the constraint uses, so there is
-- one definition of "these two share ground" and the friendly message and the
-- guarantee cannot drift apart.

create or replace function public.save_hive_formation_layout(
  p_formation_id uuid,
  p_slots jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clash record;
  removed int;
  emptied int;
  changed int;
  added int;
begin
  if not public.has_permission('hive.plan') then
    raise exception 'drawing a hive formation requires the hive.plan permission'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.hive_formations
                  where formation_id = p_formation_id) then
    raise exception 'no such formation' using errcode = '23503';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'the layout must be a json array of {dx, dy} objects'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_slots) as i(dx int, dy int)
     where i.dx is null or i.dy is null
  ) then
    raise exception 'every slot needs an integer dx and dy' using errcode = '22023';
  end if;

  -- SAID PLAINLY RATHER THAN LEFT TO THE CONSTRAINT, and now said with the
  -- sizes the constraint actually uses. A 1x1 marker beside a base is not a
  -- clash; a 4x3 structure two tiles from one is.
  select a.dx as adx, a.dy as ady, b.dx as bdx, b.dy as bdy
    into clash
    from jsonb_to_recordset(p_slots) as a(dx int, dy int, span_x int, span_y int)
    join jsonb_to_recordset(p_slots) as b(dx int, dy int, span_x int, span_y int)
      on (a.dx, a.dy) < (b.dx, b.dy)
     and int4range(a.dx - (coalesce(a.span_x, 3) - 1) / 2,
                   a.dx - (coalesce(a.span_x, 3) - 1) / 2 + coalesce(a.span_x, 3))
         && int4range(b.dx - (coalesce(b.span_x, 3) - 1) / 2,
                      b.dx - (coalesce(b.span_x, 3) - 1) / 2 + coalesce(b.span_x, 3))
     and int4range(a.dy - (coalesce(a.span_y, 3) - 1) / 2,
                   a.dy - (coalesce(a.span_y, 3) - 1) / 2 + coalesce(a.span_y, 3))
         && int4range(b.dy - (coalesce(b.span_y, 3) - 1) / 2,
                      b.dy - (coalesce(b.span_y, 3) - 1) / 2 + coalesce(b.span_y, 3))
   limit 1;
  if found then
    raise exception
      'two tiles would share ground: the one at %,% and the one at %,% overlap at their sizes',
      clash.adx, clash.ady, clash.bdx, clash.bdy
      using errcode = '23514';
  end if;

  with gone as (
    delete from public.hive_formation_slots s
     where s.formation_id = p_formation_id
       and not exists (
         select 1 from jsonb_to_recordset(p_slots) as i(dx int, dy int)
          where i.dx = s.dx and i.dy = s.dy
       )
    returning s.player_id
  )
  select count(*)::int, count(player_id)::int into removed, emptied from gone;

  update public.hive_formation_slots s
     set ordinal = coalesce(i.ordinal, 0),
         label = coalesce(i.label, ''),
         span_x = coalesce(i.span_x, 3),
         span_y = coalesce(i.span_y, 3),
         kind = coalesce(i.kind, 'base'),
         colour = i.colour,
         -- A tile that stops being a base stops holding anybody, which the
         -- check constraint would otherwise refuse mid-update.
         player_id = case when coalesce(i.kind, 'base') = 'base' then s.player_id else null end
    from jsonb_to_recordset(p_slots)
      as i(dx int, dy int, ordinal int, label text, span_x int, span_y int,
           kind text, colour text)
   where s.formation_id = p_formation_id
     and i.dx = s.dx and i.dy = s.dy
     and (s.ordinal, s.label, s.span_x, s.span_y, s.kind, s.colour)
         is distinct from (coalesce(i.ordinal, 0), coalesce(i.label, ''),
                           coalesce(i.span_x, 3), coalesce(i.span_y, 3),
                           coalesce(i.kind, 'base'), i.colour);
  get diagnostics changed = row_count;

  insert into public.hive_formation_slots
    (formation_id, dx, dy, ordinal, label, span_x, span_y, kind, colour)
  select p_formation_id, i.dx, i.dy, coalesce(i.ordinal, 0), coalesce(i.label, ''),
         coalesce(i.span_x, 3), coalesce(i.span_y, 3), coalesce(i.kind, 'base'), i.colour
    from jsonb_to_recordset(p_slots)
      as i(dx int, dy int, ordinal int, label text, span_x int, span_y int,
           kind text, colour text)
   on conflict (formation_id, dx, dy) do nothing;
  get diagnostics added = row_count;

  update public.hive_formations
     set updated_at = now()
   where formation_id = p_formation_id;

  return jsonb_build_object(
    'slots', (select count(*) from public.hive_formation_slots
               where formation_id = p_formation_id),
    'added', added,
    'changed', changed,
    'removed', removed,
    'unassigned', emptied
  );
end;
$$;

-- The board carries the size and the look, or the screen has to guess them.
--
-- THE NEW COLUMNS GO AT THE END, and not where they read best. `create or
-- replace view` may append but may not insert or reorder: putting span_x
-- after `label` renames the fifteenth column and Postgres refuses with
-- "cannot change name of view column player_id to span_x". Same family as the
-- frozen star this repo hit at 0156 — a view's shape is a contract with
-- everything already reading it.
create or replace view public.hive_formation_board
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
  f.anchor_x + s.dx as x,
  f.anchor_y + s.dy as y,
  ((f.anchor_x + s.dx)::bigint * 1000 + (f.anchor_y + s.dy)) as point_id,
  s.ordinal,
  s.label,
  s.player_id,
  p.game_uid,
  p.current_name as player_name,
  p.hq_level,
  p.power,
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
  s.updated_at,
  s.span_x,
  s.span_y,
  s.kind,
  s.colour
from public.hive_formation_slots s
join public.hive_formations f on f.formation_id = s.formation_id
left join public.players p on p.player_id = s.player_id;

grant select on public.hive_formation_board to authenticated;
