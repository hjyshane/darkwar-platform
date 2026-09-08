-- 0167: save a formation in one call, because saving it in several cannot
-- work.
--
-- THE CONSTRAINTS FROM 0165 MAKE PIECEWISE WRITES IMPOSSIBLE, and that is a
-- feature rather than an obstacle. Two examples, both of which the editor does
-- constantly:
--
--   SHIFTING A SHAPE ONE TILE EAST. Every new slot overlaps the old slot it
--   replaces. Insert-then-delete violates the exclusion constraint on the
--   first row; delete-then-insert works only if nothing else lands in
--   between. Through PostgREST those are two requests and two transactions.
--
--   SWAPPING TWO MEMBERS. `hive_slot_one_place_per_member` refuses the first
--   of the two updates. There is no order that works, because the invalid
--   state is the halfway point rather than either end.
--
-- So the unit of writing is the WHOLE formation, in one transaction, and
-- these two functions are it. A client that has to be trusted to sequence
-- writes correctly is a client that will eventually be trusted wrongly.
--
-- Both are security definer with an explicit `has_permission` gate, in the
-- shape 0053 established. Definer because a multi-statement rewrite under RLS
-- re-evaluates the policy per row for no benefit; the gate at the top is the
-- same sentence the policies say.
--
-- Both RAISE on bad input, and that is safe here for the reason the repo's
-- throttle was not: these write nothing they need to keep. A rejected layout
-- must leave the old one exactly as it was.

create function public.save_hive_formation_layout(
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

  -- RE-PARSED IN EVERY STATEMENT RATHER THAN HELD IN A TEMP TABLE, and both
  -- halves of that are deliberate. `set search_path = ''` puts pg_temp out of
  -- reach, so an unqualified temp table would not resolve at all; and a temp
  -- table created inside a function is not re-entrant — a second call in the
  -- same transaction (which is what a test suite is) fails on the create.
  -- `jsonb_to_recordset` costs nothing at the size of a formation.
  if exists (
    select 1 from jsonb_to_recordset(p_slots) as i(dx int, dy int)
     where i.dx is null or i.dy is null
  ) then
    raise exception 'every slot needs an integer dx and dy' using errcode = '22023';
  end if;

  -- SAID PLAINLY RATHER THAN LEFT TO THE CONSTRAINT. The exclusion in 0165
  -- is the guarantee, and it will refuse this anyway; what it cannot do is
  -- name the two tiles in language an officer reading a toast can act on.
  --
  -- A base centred on dx covers dx-1..dx+1, so two centres share ground when
  -- they are less than 3 apart on BOTH axes. Less than 3 on one axis alone is
  -- a packed hive and is exactly what the officer is drawing.
  select a.dx as adx, a.dy as ady, b.dx as bdx, b.dy as bdy
    into clash
    from jsonb_to_recordset(p_slots) as a(dx int, dy int)
    join jsonb_to_recordset(p_slots) as b(dx int, dy int)
      on (a.dx, a.dy) < (b.dx, b.dy)
     and abs(a.dx - b.dx) < 3
     and abs(a.dy - b.dy) < 3
   limit 1;
  if found then
    raise exception
      'two bases would share ground: offsets %,% and %,% are less than 3 tiles apart on both axes',
      clash.adx, clash.ady, clash.bdx, clash.bdy
      using errcode = '23514';
  end if;

  -- DELETE FIRST. A shape moved by one tile replaces every slot with one that
  -- overlaps it, so inserting before deleting cannot succeed for any shape
  -- that moved at all.
  --
  -- The assignments on removed tiles go with them, which is the honest
  -- outcome: the ground no longer exists, so nobody is standing on it. The
  -- count comes back so the caller can say so rather than discovering it on
  -- the next read.
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
     set ordinal = coalesce(i.ordinal, 0), label = coalesce(i.label, '')
    from jsonb_to_recordset(p_slots) as i(dx int, dy int, ordinal int, label text)
   where s.formation_id = p_formation_id
     and i.dx = s.dx and i.dy = s.dy
     and (s.ordinal, s.label)
         is distinct from (coalesce(i.ordinal, 0), coalesce(i.label, ''));
  get diagnostics changed = row_count;

  insert into public.hive_formation_slots (formation_id, dx, dy, ordinal, label)
  select p_formation_id, i.dx, i.dy, coalesce(i.ordinal, 0), coalesce(i.label, '')
    from jsonb_to_recordset(p_slots) as i(dx int, dy int, ordinal int, label text)
   on conflict (formation_id, dx, dy) do nothing;
  get diagnostics added = row_count;

  -- Touched so the formation's own updated_at moves with its shape. A list
  -- ordered by "last edited" that does not notice a redraw is a list that
  -- sorts by when somebody last renamed something.
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

comment on function public.save_hive_formation_layout(uuid, jsonb) is
  'Replace a formation''s tiles in one transaction. Assignments on tiles that '
  'survive are kept; the count of those lost with removed tiles comes back in '
  'the result.';

create function public.assign_hive_formation_slots(
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
    raise exception 'the assignments must be a json array of {slot_id, player_id} objects'
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
  update public.hive_formation_slots s
     set player_id = null
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

comment on function public.assign_hive_formation_slots(uuid, jsonb) is
  'Replace a formation''s assignments in one transaction. Anything not named '
  'is emptied, which is what makes an auto-assignment a single atomic act '
  'rather than eighty updates that fail halfway.';

grant execute on function public.save_hive_formation_layout(uuid, jsonb) to authenticated;
grant execute on function public.assign_hive_formation_slots(uuid, jsonb) to authenticated;
