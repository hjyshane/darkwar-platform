-- 0173: a formation may grow, because the friendly message stops being the
-- thing that limits it.
--
-- The editor capped a formation at a few thousand tiles. That cap was never
-- about what a hive needs or what the tables hold — it was about what the
-- SAVE could do in reasonable time, and the expensive half of the save turned
-- out to be the part that exists only to word a refusal nicely.
--
-- 0167 added a pre-check that finds two overlapping tiles and names their
-- coordinates, because the exclusion constraint's own message names a
-- constraint rather than a place. 0170 taught it per-row sizes. It is a
-- self-join over every pair, so it is quadratic, and past a couple of
-- thousand tiles it dominates everything else the function does.
--
-- Measured on this schema, not assumed — see the table in the body.
--
-- The fix is to keep the good message where it is affordable and let the
-- constraint speak where it is not. Nothing about what is ALLOWED changes:
-- the exclusion constraint from 0169 is unchanged and is still what makes an
-- overlapping layout impossible. Only the wording of the refusal differs, and
-- only for layouts far larger than anyone draws by hand.

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

  -- SAID PLAINLY RATHER THAN LEFT TO THE CONSTRAINT — but only while saying
  -- it is cheap, which is what this size test is for.
  --
  -- This is a self-join over every PAIR of tiles, so it is quadratic, and the
  -- cost was measured against the schema rather than guessed:
  --
  --     tiles      pre-check      the insert it guards
  --     1,000        176 ms                   36 ms
  --     5,000      4,075 ms                  179 ms
  --    10,000     10,522 ms                  554 ms
  --    20,000     39,260 ms                1,205 ms
  --
  -- The insert is index-backed by the exclusion constraint and stays near
  -- linear; the friendly message costs twenty to thirty times the work it is
  -- describing, and it alone is why a formation could not grow past a few
  -- thousand tiles. Above the threshold the exclusion constraint is left to
  -- refuse the write on its own — it was always the guarantee, and this was
  -- only ever the wording.
  --
  -- The wording is kept exactly where it earns its place: a small layout is a
  -- hand-drawn one, where two tiles really can be nudged into each other and
  -- the officer needs to be told which two. A large one comes out of the
  -- sweep tools, which refuse an overlapping tile before it is ever drawn.
  if jsonb_array_length(p_slots) <= 1000 then
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
