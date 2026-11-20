-- 0339: reanchor_hive_formation - put the anchor somewhere else and leave
-- every tile where it is.
--
-- WHY. Every tile is stored as an offset from the anchor, so moving the anchor
-- (`move_hive_formation`, 0330) moves the whole formation — which is what it
-- is for. What it cannot do is the other thing an officer asks for: "measure
-- this plan from Frankie", or from the alliance HQ, or from a base that is
-- already drawn. Until now that meant moving the anchor and then redrawing the
-- whole shape back where it was. This changes the anchor and shifts every
-- offset by the opposite amount, so nothing on the map moves.
--
-- VERSION-CHECKED, unlike a move. A move changes no offset, so it makes
-- nobody's unsaved draft stale; this changes every one of them, and a draft
-- built on the old offsets saved afterwards would put the whole shape back
-- down shifted. The version goes up, and such a save is refused as stale.
--
-- LIFTED AND PUT BACK, NOT UPDATED IN PLACE. Shifting every offset with one
-- UPDATE trips over itself: the unique (formation_id, dx, dy) and the overlap
-- exclusion are checked row by row as the update goes, so a tile moving onto
-- the offset its neighbour has not left yet is refused — in a packed hive,
-- that is nearly every re-anchor. And the on-map triggers (0165/0169) read the
-- anchor, so any order of "anchor first" or "tiles first" passes through a
-- moment where the formation looks shifted and may hang off the edge of the
-- world. Deleting the tiles, moving the anchor while there are none, and
-- inserting them back at their new offsets has no such moment: each check sees
-- either nothing or the finished state. One transaction, so nobody reads the
-- gap.
--
-- WHAT COMES BACK IS THE SAME TILE. Same slot id (the editor and the board key
-- on it), same member, same pin, same caption and size, and the same
-- assigned_at/assigned_by — which the assignment stamp (0165) would otherwise
-- rewrite on insert, crediting every assignment in the plan to whoever moved
-- the anchor. It is told to keep them through a transaction-local setting that
-- only this function sets; nothing outside a security-definer function can
-- write these rows since 0330, so nothing else can reach that branch.
--
-- Deliberately not: re-anchoring a deleted plan (restore it first), or a
-- templated "anchor on structure X" — which object the anchor goes on is the
-- editor's choice, sent as a coordinate like any other.

create or replace function public.hive_slots_stamp_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A tile put back by reanchor_hive_formation keeps who put the member there
  -- and when: nothing about the assignment changed.
  if tg_op = 'INSERT' and current_setting('dw.hive_keep_assignment', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' or new.player_id is distinct from old.player_id then
    if new.player_id is null then
      new.assigned_at := null;
      new.assigned_by := null;
    else
      new.assigned_at := now();
      new.assigned_by := auth.uid();
    end if;
  else
    new.assigned_at := old.assigned_at;
    new.assigned_by := old.assigned_by;
  end if;
  return new;
end;
$$;

create function public.reanchor_hive_formation(
  p_formation_id uuid,
  p_version int,
  p_from_x int,
  p_from_y int,
  p_to_x int,
  p_to_y int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.hive_formations;
  v_tiles public.hive_formation_slots[];
  v_by_x int := p_to_x - p_from_x;
  v_by_y int := p_to_y - p_from_y;
begin
  v_plan := internal.hive_formation_lock(p_formation_id);
  if v_plan.deleted_at is not null then
    raise exception 'this plan was deleted' using errcode = 'P0002';
  end if;
  if (v_plan.anchor_x, v_plan.anchor_y) is distinct from (p_from_x, p_from_y) then
    raise exception 'the anchor was moved after you opened this plan'
      using errcode = 'PT409';
  end if;
  if p_version is distinct from v_plan.version then
    raise exception 'somebody else saved this plan after you opened it'
      using errcode = 'PT409';
  end if;

  -- Already there: nothing changes, so nothing is stamped and no draft goes
  -- stale.
  if v_by_x <> 0 or v_by_y <> 0 then
    select coalesce(array_agg(s), '{}') into v_tiles
      from public.hive_formation_slots s
     where s.formation_id = p_formation_id;

    delete from public.hive_formation_slots where formation_id = p_formation_id;

    -- With no tiles, the anchor's own on-map check has nothing to refuse; the
    -- anchor's range check (1..998) still applies.
    update public.hive_formations
       set anchor_x = p_to_x,
           anchor_y = p_to_y,
           version = version + 1
     where formation_id = p_formation_id;

    perform set_config('dw.hive_keep_assignment', 'on', true);
    insert into public.hive_formation_slots
      (slot_id, formation_id, dx, dy, ordinal, label, player_id, assigned_at, assigned_by,
       created_at, updated_at, span_x, span_y, kind, colour, pinned)
    select t.slot_id, t.formation_id, t.dx - v_by_x, t.dy - v_by_y, t.ordinal, t.label,
           t.player_id, t.assigned_at, t.assigned_by, t.created_at, t.updated_at,
           t.span_x, t.span_y, t.kind, t.colour, t.pinned
      from unnest(v_tiles) as t;
    perform set_config('dw.hive_keep_assignment', 'off', true);

    perform internal.hive_formation_stamp(p_formation_id);
  end if;

  return (
    select jsonb_build_object(
             'anchor_x', f.anchor_x,
             'anchor_y', f.anchor_y,
             'version', f.version,
             'edited_at', f.edited_at,
             'edited_by_name', f.edited_by_name)
      from public.hive_formations f
     where f.formation_id = p_formation_id);
end;
$$;

comment on function public.reanchor_hive_formation(uuid, int, int, int, int, int) is
  'Put the anchor on another square and keep every tile where it is: each '
  'offset shifts by the opposite amount. Checked against the anchor and the '
  'version the officer opened, and bumps the version — every offset changes, '
  'so a draft built on the old ones is stale.';

revoke all on function public.reanchor_hive_formation(uuid, int, int, int, int, int)
  from public, anon;
grant execute on function public.reanchor_hive_formation(uuid, int, int, int, int, int)
  to authenticated;
