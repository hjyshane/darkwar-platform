-- 0330: hive safety. Two officers planning one hive stop losing each
-- other's work, a deleted plan can be brought back, and every plan says who
-- last changed it.
--
-- Design: docs/superpowers/specs/2026-11-15-hive-safety-design.md (approved
-- by the owner 2026-11-15). The short version of what was wrong:
--
-- - THE LAST SAVE WON. Saving a hive was up to four separate requests (shape,
--   a re-read, people, and the anchor straight on the table), and none of
--   them asked whether somebody else had saved in between.
-- - DELETE WAS FOREVER. A hard delete cascading to every tile and assignment,
--   one confirm away from a button that only copies text.
-- - NOBODY WAS NAMED. A plan carried who created it, never who changed it.
--
-- WHAT COUNTS AS WHAT. `version` moves on a saved change to the shape or the
-- people, and on nothing else. It does NOT move when the anchor moves: a save sends
-- offsets and people and never the anchor, so somebody else's anchor move
-- does not make an unsaved draft stale, and refusing it would throw away work
-- that is still valid (the editor already keeps its draft across a move). Two
-- anchor moves are judged against each other by the anchor each mover saw.
-- Make-live and delete are not edits at all: neither is checked, and delete
-- can be undone. Restore brings back exactly what was deleted, so it keeps the
-- version too (see restore_hive_formation). The "last changed by" stamp
-- records shape, people, anchor and restore — an anchor move changes every
-- member's coordinate.
--
-- This file is in two halves: the columns, the stamp, soft delete, restore
-- and the cleanup first; then the checked writes and the doors they replace.

-- ---------------------------------------------------------------------------
-- The columns.

alter table public.hive_formations
  add column version int not null default 1,
  add column edited_at timestamptz not null default now(),
  add column edited_by uuid references auth.users (id) on delete set null,
  add column edited_by_name text,
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null,
  add column deleted_by_name text;

comment on column public.hive_formations.version is
  'Moves with every saved change to the shape or the people. A save names the '
  'version it was made from and is refused (PT409) if the plan has moved on. '
  'Not moved by an anchor move, make-live, delete or restore.';
comment on column public.hive_formations.edited_by_name is
  'Who last changed the shape, the people or the anchor, as they were named '
  'at the time: their character, else the account''s display name. Stored, '
  'not joined, so a member reads it from the row they already see.';
comment on column public.hive_formations.deleted_at is
  'Set by delete_hive_formation. A deleted plan is hidden from members and '
  'from the board, restorable by an officer, and removed for good 30 days '
  'later by internal.purge_deleted_hive_formations.';

-- ---------------------------------------------------------------------------
-- Who is asking, by name. The same order as post_authors (0080): the
-- character first, because that is how the alliance knows each other.

create function internal.hive_actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.current_name, u.display_name)
    from public.app_users u
    left join public.players p on p.player_id = u.player_id
   where u.user_id = (select auth.uid())
$$;

revoke all on function internal.hive_actor_name() from public, anon, authenticated;

-- Existing plans were last changed when they were last updated, by whoever
-- created them: the best the rows can say. `set_updated_at` is held off for
-- the backfill so updated_at keeps its history rather than reading "today"
-- for every plan.
alter table public.hive_formations disable trigger hive_formations_set_updated_at;
update public.hive_formations f
   set edited_at = f.updated_at,
       edited_by = f.created_by,
       edited_by_name = (
         select coalesce(p.current_name, u.display_name)
           from public.app_users u
           left join public.players p on p.player_id = u.player_id
          where u.user_id = f.created_by)
 where f.formation_id is not null;
alter table public.hive_formations enable trigger hive_formations_set_updated_at;

-- 0165's actor trigger, extended. Creating a plan is still a direct insert
-- from the browser, so the insert is where a forged version, stamp or
-- "already deleted" has to be stopped: the trigger writes them, whatever was
-- sent. Updates keep 0165's rule and nothing else — after this migration the
-- browser cannot update a plan at all, and the functions below are trusted to
-- write the stamp themselves.
create or replace function public.hive_formations_set_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.version := 1;
    new.edited_at := now();
    new.edited_by := auth.uid();
    new.edited_by_name := internal.hive_actor_name();
    new.deleted_at := null;
    new.deleted_by := null;
    new.deleted_by_name := null;
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers every write below starts with.

-- THE ROW LOCK IS THE CHECK'S OTHER HALF. Two saves arriving together both
-- read version 5 without it, and both would pass. `for update` makes the
-- second wait for the first to commit and then read 6.
--
-- The alliance is judged BEFORE anything else can answer. A version check
-- that ran first would tell a signed-in user from another alliance whether
-- the plan exists and which version it is at; 0194's guard trigger would only
-- have caught the write that followed.
--
-- A deleted plan is NOT refused here: restore needs to lock exactly that row.
-- Each caller decides what a deleted plan means for it.
create function internal.hive_formation_lock(p_formation_id uuid)
returns public.hive_formations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.hive_formations;
begin
  if not public.has_permission('hive.plan') then
    raise exception 'changing a hive plan requires the hive.plan permission'
      using errcode = '42501';
  end if;
  select * into v_plan
    from public.hive_formations
   where formation_id = p_formation_id
     for update;
  if not found then
    raise exception 'no such formation' using errcode = 'P0002';
  end if;
  perform public.refuse_other_alliance(v_plan.alliance_id);
  return v_plan;
end;
$$;

create function internal.hive_formation_stamp(p_formation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.hive_formations
     set edited_at = now(),
         edited_by = (select auth.uid()),
         edited_by_name = internal.hive_actor_name()
   where formation_id = p_formation_id;
$$;

revoke all on function internal.hive_formation_lock(uuid) from public, anon, authenticated;
revoke all on function internal.hive_formation_stamp(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Delete and restore.

-- NOT VERSION-CHECKED, because it can be undone. Deleting an already deleted
-- plan is a no-op — a double press — and does not re-credit the delete to
-- whoever pressed second. A deleted plan stops being live: it must not hold
-- the one-live-plan-per-server slot (0194's unique index) while hidden.
create function public.delete_hive_formation(p_formation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.hive_formations;
begin
  v_plan := internal.hive_formation_lock(p_formation_id);
  if v_plan.deleted_at is not null then
    return;
  end if;
  update public.hive_formations
     set deleted_at = now(),
         deleted_by = (select auth.uid()),
         deleted_by_name = internal.hive_actor_name(),
         is_active = false
   where formation_id = p_formation_id;
end;
$$;

-- RESTORE KEEPS THE VERSION. The plan comes back exactly as it was before the
-- delete, and nothing can be saved to a deleted plan, so a draft built on that
-- version is still a draft of this plan. The officer who had it open when
-- somebody else pressed Delete restores it and saves; bumping the version
-- here would tell them their work was stale and leave them only "Load the new
-- version", which drops it. The restorer is stamped as the last to change it.
--
-- It comes back NOT live: another plan may have been made live since, and two
-- live plans is the state where a member reads the wrong coordinate.
-- Restoring a plan that is not deleted changes nothing.
create function public.restore_hive_formation(p_formation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.hive_formations;
begin
  v_plan := internal.hive_formation_lock(p_formation_id);
  if v_plan.deleted_at is not null then
    update public.hive_formations
       set deleted_at = null,
           deleted_by = null,
           deleted_by_name = null
     where formation_id = p_formation_id;
    perform internal.hive_formation_stamp(p_formation_id);
  end if;
  return (
    select jsonb_build_object(
             'version', f.version,
             'edited_at', f.edited_at,
             'edited_by_name', f.edited_by_name)
      from public.hive_formations f
     where f.formation_id = p_formation_id);
end;
$$;

revoke all on function public.delete_hive_formation(uuid) from public, anon;
revoke all on function public.restore_hive_formation(uuid) from public, anon;
grant execute on function public.delete_hive_formation(uuid) to authenticated;
grant execute on function public.restore_hive_formation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The cleanup: 30 days, the owner's choice (2026-11-15). Tiles go by cascade;
-- 0194's slot guard already lets a cascade through when the parent is gone,
-- and with no signed-in user the plan's own guard is a no-op.
create function internal.purge_deleted_hive_formations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed int;
begin
  delete from public.hive_formations
   where deleted_at < now() - interval '30 days';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function internal.purge_deleted_hive_formations() from public, anon, authenticated;

comment on function internal.purge_deleted_hive_formations() is
  'Removes hive plans deleted more than 30 days ago, tiles and all (0330). Daily.';

select cron.schedule(
  'hive-purge-deleted',
  '41 3 * * *',
  $$ select internal.purge_deleted_hive_formations(); $$);

-- ---------------------------------------------------------------------------
-- Who reads a deleted plan.

-- Members never: a deleted plan is not something anybody should teleport off.
-- Officers do, for the "Recently deleted" list they restore from. Their tiles
-- follow through 0194's alliance_scope on slots, which asks whether the
-- parent is visible.
drop policy member_read on public.hive_formations;
create policy member_read on public.hive_formations
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin')
         and (deleted_at is null or (select public.has_permission('hive.plan'))));

-- The board is what members are told to follow, so it leaves a deleted plan
-- out for everybody, officers included. It also says which version of the
-- plan it was read from, so the editor knows what its draft was built on.
-- Otherwise identical to 0196; the new column is appended, which
-- `create or replace view` requires.
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
      -- In THIS formation's alliance's roster, not any own alliance's.
      where r.alliance_id = coalesce(f.alliance_id, public.primary_own_alliance())
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
  s.pinned,
  f.version as formation_version
from public.hive_formation_slots s
join public.hive_formations f on f.formation_id = s.formation_id
left join public.players p on p.player_id = s.player_id
where f.deleted_at is null;

-- ===========================================================================
-- The checked writes.

-- THE SHAPE AND THE PEOPLE IN ONE TRANSACTION. The editor used to save a
-- changed shape in three requests — the layout, a re-read of the board, and
-- the people put back by offset — and a save from somebody else could land
-- between any two of them. One call now does all of it under the row lock,
-- after the version check, so a save is either wholly on the version it was
-- made from or refused.
--
-- People are named by OFFSET, not slot id: a moved tile is deleted and
-- reinserted under a new id by the layout half, so the offset is the only
-- thing that still finds it. The tested logic is reused, not copied — this
-- calls 0177's two functions, as their owner, once the browser can no longer
-- call them itself.
--
-- `p_slots` null keeps the shape; `p_assignments` null keeps the people.
-- Every tile the people payload does not name is emptied, as before.
create function public.save_hive_formation(
  p_formation_id uuid,
  p_version int,
  p_slots jsonb,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.hive_formations;
  v_layout jsonb := '{}'::jsonb;
  v_displaced uuid[] := '{}';
  v_stranger record;
  v_lost int;
begin
  v_plan := internal.hive_formation_lock(p_formation_id);
  if v_plan.deleted_at is not null then
    raise exception 'this plan was deleted' using errcode = 'P0002';
  end if;
  if p_version is distinct from v_plan.version then
    raise exception 'somebody else saved this plan after you opened it'
      using errcode = 'PT409';
  end if;
  if p_slots is null and p_assignments is null then
    raise exception 'nothing to save: send the shape, the people, or both'
      using errcode = '22023';
  end if;
  if p_assignments is not null and jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'the people must be a json array of {dx, dy, player_id, pinned} objects'
      using errcode = '22023';
  end if;

  if p_slots is not null then
    -- Who stands on a tile this save erases, worked out while the tiles are
    -- still there. Anybody among them who stands nowhere afterwards lost
    -- their tile, and the editor says so rather than letting it be found out.
    if jsonb_typeof(p_slots) = 'array' then
      select coalesce(array_agg(s.player_id), '{}') into v_displaced
        from public.hive_formation_slots s
       where s.formation_id = p_formation_id
         and s.player_id is not null
         and not exists (
           select 1 from jsonb_to_recordset(p_slots) as i(dx int, dy int)
            where i.dx = s.dx and i.dy = s.dy);
    end if;
    v_layout := public.save_hive_formation_layout(p_formation_id, p_slots);
  end if;

  if p_assignments is not null then
    if exists (
      select 1 from jsonb_to_recordset(p_assignments) as a(dx int, dy int)
       group by a.dx, a.dy having count(*) > 1
    ) then
      raise exception 'two people were sent to the same tile in one save'
        using errcode = '22023';
    end if;
    select a.dx, a.dy into v_stranger
      from jsonb_to_recordset(p_assignments) as a(dx int, dy int)
      left join public.hive_formation_slots s
        on s.formation_id = p_formation_id and s.dx = a.dx and s.dy = a.dy
     where s.slot_id is null
     limit 1;
    if found then
      raise exception 'there is no tile at %,% to send anybody to', v_stranger.dx, v_stranger.dy
        using errcode = '23503';
    end if;
    perform public.assign_hive_formation_slots(
      p_formation_id,
      (select coalesce(jsonb_agg(jsonb_build_object(
                'slot_id', s.slot_id,
                'player_id', a.player_id,
                'pinned', coalesce(a.pinned, false))), '[]'::jsonb)
         from public.hive_formation_slots s
         left join jsonb_to_recordset(p_assignments)
           as a(dx int, dy int, player_id uuid, pinned boolean)
           on a.dx = s.dx and a.dy = s.dy
        where s.formation_id = p_formation_id));
  end if;

  update public.hive_formations
     set version = version + 1
   where formation_id = p_formation_id;
  perform internal.hive_formation_stamp(p_formation_id);

  select count(*)::int into v_lost
    from unnest(v_displaced) as d(player_id)
   where not exists (
     select 1 from public.hive_formation_slots s
      where s.formation_id = p_formation_id and s.player_id = d.player_id);

  return (
    select jsonb_build_object(
             'version', f.version,
             'edited_at', f.edited_at,
             'edited_by_name', f.edited_by_name,
             'slots', (select count(*) from public.hive_formation_slots s
                        where s.formation_id = p_formation_id),
             'added', coalesce((v_layout ->> 'added')::int, 0),
             'changed', coalesce((v_layout ->> 'changed')::int, 0),
             'removed', coalesce((v_layout ->> 'removed')::int, 0),
             'unassigned', coalesce((v_layout ->> 'unassigned')::int, 0),
             'assigned', (select count(*) from public.hive_formation_slots s
                           where s.formation_id = p_formation_id
                             and s.player_id is not null),
             'lost', v_lost)
      from public.hive_formations f
     where f.formation_id = p_formation_id);
end;
$$;

-- CHECKED AGAINST THE ANCHOR THE MOVER SAW, not the version: see the header.
-- Two officers dragging the anchor at once are caught here; an officer
-- redrawing the shape while somebody else nudges the anchor is not blocked.
create function public.move_hive_formation(
  p_formation_id uuid,
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
begin
  v_plan := internal.hive_formation_lock(p_formation_id);
  if v_plan.deleted_at is not null then
    raise exception 'this plan was deleted' using errcode = 'P0002';
  end if;
  if (v_plan.anchor_x, v_plan.anchor_y) is distinct from (p_from_x, p_from_y) then
    raise exception 'the anchor was moved after you opened this plan'
      using errcode = 'PT409';
  end if;
  update public.hive_formations
     set anchor_x = p_to_x,
         anchor_y = p_to_y
   where formation_id = p_formation_id;
  perform internal.hive_formation_stamp(p_formation_id);
  return (
    select jsonb_build_object(
             'anchor_x', f.anchor_x,
             'anchor_y', f.anchor_y,
             'edited_at', f.edited_at,
             'edited_by_name', f.edited_by_name)
      from public.hive_formations f
     where f.formation_id = p_formation_id);
end;
$$;

-- ONE CALL, NEVER TWO LIVE AND NEVER NONE. The site used to stand the old
-- plan down and raise the new one in two requests; if the second was refused
-- (a deleted plan, a lost connection) the alliance was left with no live plan
-- and nobody was told. Not an edit: no version, no stamp.
--
-- The stand-down mirrors 0194's unique index (alliance_id, server_id, nulls
-- not distinct): the plan it would collide with is exactly the one cleared.
create function public.make_hive_formation_live(p_formation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.hive_formations;
begin
  v_plan := internal.hive_formation_lock(p_formation_id);
  if v_plan.deleted_at is not null then
    raise exception 'this plan was deleted' using errcode = 'P0002';
  end if;
  if v_plan.is_active then
    return;
  end if;
  update public.hive_formations
     set is_active = false
   where server_id = v_plan.server_id
     and alliance_id is not distinct from v_plan.alliance_id
     and is_active
     and formation_id <> p_formation_id;
  update public.hive_formations
     set is_active = true
   where formation_id = p_formation_id;
end;
$$;

revoke all on function public.save_hive_formation(uuid, int, jsonb, jsonb) from public, anon;
revoke all on function public.move_hive_formation(uuid, int, int, int, int) from public, anon;
revoke all on function public.make_hive_formation_live(uuid) from public, anon;
grant execute on function public.save_hive_formation(uuid, int, jsonb, jsonb) to authenticated;
grant execute on function public.move_hive_formation(uuid, int, int, int, int) to authenticated;
grant execute on function public.make_hive_formation_live(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The doors those functions replace.
--
-- A check the browser can walk around is not a check. A copy of the site
-- cached from before this migration would otherwise go on saving tiles, moving
-- anchors and deleting plans for good with no version in sight. Creating a
-- plan stays a direct insert: there is nothing yet to be stale against, and
-- the actor trigger above writes everything a forger would want to.
--
-- Between `db push` and the deploy of the new site, the old site cannot save
-- a hive (reading still works). Push, then merge right away.

drop policy planner_update on public.hive_formations;
drop policy planner_delete on public.hive_formations;
drop policy planner_insert on public.hive_formation_slots;
drop policy planner_update on public.hive_formation_slots;
drop policy planner_delete on public.hive_formation_slots;

revoke update, delete, truncate on public.hive_formations from authenticated;
revoke insert, update, delete, truncate on public.hive_formation_slots from authenticated;
-- The hosted project grants new relations to anon by default; these two were
-- never meant to be reachable signed out.
revoke all on public.hive_formations, public.hive_formation_slots from anon;

revoke execute on function public.save_hive_formation_layout(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.assign_hive_formation_slots(uuid, jsonb)
  from public, anon, authenticated;
