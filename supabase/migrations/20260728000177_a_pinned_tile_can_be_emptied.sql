-- 0177: a pinned tile can be emptied.
--
-- 0174 put pins on the row and added `hive_pins_protect_somebody` (a pin
-- needs somebody to protect). Both writers empty a tile in one statement and
-- deal with its pin in another, later one — and a CHECK constraint is not
-- deferrable: it is tested as each row is written. So the emptying statement
-- itself was refused, with the constraint's name as the only explanation:
--
--   new row for relation "hive_formation_slots" violates check constraint
--   "hive_pins_protect_somebody"
--
-- It fired on any save that took a pinned member off their tile — moving
-- them, replacing them, or (since the board started emptying the tiles of
-- members who left the alliance) simply saving after a pinned member left.
--
-- The rule is right and stays. The two functions now clear the pin in the
-- same statement that clears the member. Otherwise identical to 0173 and
-- 0174.

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
         player_id = case when coalesce(i.kind, 'base') = 'base' then s.player_id else null end,
         -- 0177: the pin goes with the member, IN THE SAME STATEMENT. The
         -- check constraint is tested row by row as this update writes, so
         -- a pin left for a later statement to clear is already too late.
         pinned = case when coalesce(i.kind, 'base') = 'base' then s.pinned else false end
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

create or replace function public.assign_hive_formation_slots(
  p_formation_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stranger uuid;
  twice uuid;
  cleared int;
  filled int;
begin
  if not public.has_permission('hive.plan') then
    raise exception 'assigning a hive slot requires the hive.plan permission'
      using errcode = '42501';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'the assignments must be a json array of {slot_id, player_id, pinned} objects'
      using errcode = '22023';
  end if;

  -- Re-parsed per statement rather than held in a temp table, for the reason
  -- `save_hive_formation_layout` gives above: pg_temp is out of reach under
  -- an empty search_path, and a temp table makes the function single-use
  -- within a transaction.
  --
  -- A slot_id from another formation would be written happily and silently.
  -- Keyed on the primary key rather than on dx,dy precisely so a stale id
  -- fails loudly instead of landing on whatever is at those offsets now.
  select w.slot_id into stranger
    from jsonb_to_recordset(p_assignments) as w(slot_id uuid)
    left join public.hive_formation_slots s
      on s.slot_id = w.slot_id and s.formation_id = p_formation_id
   where s.slot_id is null
   limit 1;
  if found then
    raise exception 'slot % is not part of this formation', stranger
      using errcode = '23503';
  end if;

  select w.player_id into twice
    from jsonb_to_recordset(p_assignments) as w(player_id uuid)
   where w.player_id is not null
   group by w.player_id having count(*) > 1
   limit 1;
  if found then
    raise exception 'player % is assigned to more than one tile', twice
      using errcode = '23505';
  end if;

  -- CLEAR EVERYTHING THAT IS MOVING, THEN FILL. `hive_slot_one_place_per_member`
  -- refuses a swap done one row at a time, and a swap is the ordinary case
  -- once an officer starts adjusting an auto-assignment by hand.
  --
  -- A slot whose occupant is unchanged is touched by neither statement, so
  -- `assigned_at` still says when that member was actually put there rather
  -- than when the board was last saved.
  -- 0177: emptied AND unpinned in one statement. 0174 cleared the pin in a
  -- later update, but `hive_pins_protect_somebody` is checked as each row is
  -- written, so emptying a pinned tile here failed the whole save before
  -- that update was reached — any change to a pinned tile's occupant, and
  -- every save after a pinned member left the alliance.
  update public.hive_formation_slots s
     set player_id = null,
         pinned = false
   where s.formation_id = p_formation_id
     and s.player_id is not null
     and s.player_id is distinct from (
       select w.player_id
         from jsonb_to_recordset(p_assignments) as w(slot_id uuid, player_id uuid)
        where w.slot_id = s.slot_id
     );
  get diagnostics cleared = row_count;

  update public.hive_formation_slots s
     set player_id = w.player_id
    from jsonb_to_recordset(p_assignments) as w(slot_id uuid, player_id uuid)
   where s.slot_id = w.slot_id
     and s.formation_id = p_formation_id
     and s.player_id is distinct from w.player_id;
  get diagnostics filled = row_count;

  -- THE PIN IS PART OF THE PLAN, so it is written with the plan rather than
  -- kept in the officer's browser. Missing from the payload reads as false:
  -- this call replaces a formation's assignments wholesale, and a pin nobody
  -- sent is a pin nobody wants.
  --
  -- A tile with nobody on it cannot be pinned. A pin says "leave this person
  -- where they are", and on an empty tile there is no such person — left
  -- settable it would survive as a booby trap for whoever is auto-assigned
  -- there next.
  update public.hive_formation_slots s
     set pinned = coalesce(w.pinned, false) and w.player_id is not null
    from jsonb_to_recordset(p_assignments) as w(slot_id uuid, player_id uuid, pinned boolean)
   where s.slot_id = w.slot_id
     and s.formation_id = p_formation_id
     and s.pinned is distinct from (coalesce(w.pinned, false) and w.player_id is not null);

  -- Anything the payload did not name is emptied above, and an empty tile
  -- holds no pin.
  update public.hive_formation_slots s
     set pinned = false
   where s.formation_id = p_formation_id
     and s.pinned
     and s.player_id is null;

  update public.hive_formations
     set updated_at = now()
   where formation_id = p_formation_id;

  return jsonb_build_object(
    'assigned', (select count(*) from public.hive_formation_slots
                  where formation_id = p_formation_id and player_id is not null),
    'cleared', cleared,
    'changed', filled
  );
end;
$$;
