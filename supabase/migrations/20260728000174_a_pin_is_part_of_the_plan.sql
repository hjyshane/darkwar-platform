-- 0174: a pin is part of the plan, so it lives with the plan.
--
-- Pins were browser state. They had only just stopped being wiped by the
-- re-read that every save triggers, and they did not survive a reload at all —
-- an officer who decided where their R4s stand, closed the tab and came back
-- found every one of those decisions gone.
--
-- A pin is not a view preference. It says "this placement is settled, do not
-- let the next auto-fill move it", which is a fact about the formation and one
-- the other officers planning the same move need to see. So it goes on the
-- row, beside the member it protects.
--
-- STORED AS A BOOLEAN ON THE SLOT rather than as a (tile, member) pair. The
-- member is already on the row; a pair would be the same fact written twice
-- and two ways for it to disagree. It also makes the awkward case obvious
-- instead of implicit: a pin on an empty tile is meaningless, and the writes
-- below refuse to store one.

alter table public.hive_formation_slots
  add column pinned boolean not null default false;

comment on column public.hive_formation_slots.pinned is
  'Leave this member where they are when the formation is auto-filled. False '
  'on an empty tile always: a pin protects a placement, and an empty tile has '
  'none.';

-- Never pinned without somebody to protect. The RPC below already refuses it,
-- and this is the same rule where it cannot be worked around — a hand-written
-- update through PostgREST reaches the table too.
alter table public.hive_formation_slots
  add constraint hive_pins_protect_somebody
  check (not pinned or player_id is not null);

-- Appended at the END, which `create or replace view` requires: a column
-- inserted mid-list is a rename as far as Postgres is concerned and the
-- replace is refused. 0170 learned this the same way.
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
  s.colour,
  s.pinned
from public.hive_formation_slots s
join public.hive_formations f on f.formation_id = s.formation_id
left join public.players p on p.player_id = s.player_id;;

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
