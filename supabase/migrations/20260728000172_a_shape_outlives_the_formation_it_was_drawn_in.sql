-- 0172: a formation's SHAPE, saved and reloaded, without its map or its people.
--
-- 0165's real idea was that a slot is an offset from an anchor rather than a
-- coordinate, so relocating a formation is one edit. This finishes the
-- thought. If the shape is already anchor-independent, then it is also
-- formation-independent — nothing in a list of offsets says which map, which
-- week, or which eighty people. So it can be lifted out, named, and put down
-- again on a different anchor, a different server, or next month's move.
--
-- WHAT IS LIFTED AND WHAT IS LEFT BEHIND.
--
--   Lifted: dx, dy, span, kind, colour, label, ordinal. Everything about the
--   drawing.
--
--   Left behind: the anchor (it is where, not what), the server (a shape is
--   the same shape on all eight maps), and every player_id. A template that
--   remembered who stood where would be a stale roster in a new place: the
--   member it names may have left, and 0166's still_a_member flag exists
--   precisely because a fortnight is long enough for that. Filling the shape
--   is what auto-assignment does, from the roster as it is today.
--
-- THE OVERLAP RULE COMES WITH IT. A template whose tiles overlap is a
-- template that cannot be applied — the officer would find out at the moment
-- they tried to save the formation, which is the wrong moment. The same
-- exclusion constraint 0169 puts on slots goes on template slots, so a shape
-- is checked when it is stored rather than when it is used.
--
-- THERE IS NO 'DOES IT FIT THE MAP' CHECK HERE, and there cannot be: a
-- footprint runs off the edge relative to an ANCHOR, and a template has none.
-- That question is answered when the shape is applied to a formation, by the
-- trigger 0169 already installed. This is why applying a template is a
-- DRAFT operation in the editor rather than a write: the officer loads it,
-- sees where it lands, moves the anchor if it hangs off the edge, and only
-- then saves through save_hive_formation_layout like any other layout.

create table public.hive_formation_templates (
  template_id uuid primary key default gen_random_uuid(),

  -- What it gets called when somebody says "load the bear rally one".
  name text not null check (length(btrim(name)) > 0),

  -- What it is for, in the officer's words. 'Tight pack, 40 members, gate
  -- facing east'. This is the only place the intent of a shape is written
  -- down — the offsets cannot say it.
  note text not null default '',

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hive_formation_templates is
  'A saved hive shape: offsets, sizes and colours with no anchor, no server '
  'and nobody standing on them. Applying one to a formation is a draft edit, '
  'so where it lands can be seen before it is saved.';

create unique index hive_formation_templates_one_per_name
  on public.hive_formation_templates (lower(btrim(name)));

create table public.hive_formation_template_slots (
  template_slot_id uuid primary key default gen_random_uuid(),
  template_id uuid not null
    references public.hive_formation_templates (template_id) on delete cascade,

  -- The same fields a slot carries, minus the ones that mean a person or a
  -- place. Bounds copied from hive_formation_slots deliberately: a template
  -- that would be refused as a layout is not worth storing.
  dx int not null check (dx between -998 and 998),
  dy int not null check (dy between -998 and 998),
  span_x int not null default 3 check (span_x between 1 and 32),
  span_y int not null default 3 check (span_y between 1 and 32),
  kind text not null default 'base' check (kind in ('base', 'structure')),
  colour text check (colour in (
    'slate', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
  label text not null default '',
  ordinal int not null default 0,

  -- The rule the whole feature rests on, checked where the shape is STORED
  -- rather than where it is used. Byte for byte the constraint 0169 puts on
  -- hive_formation_slots, and 91's test asserts that.
  constraint hive_template_slots_do_not_overlap exclude using gist (
    template_id extensions.gist_uuid_ops with =,
    (int4range(dx - (span_x - 1) / 2, dx - (span_x - 1) / 2 + span_x)) with &&,
    (int4range(dy - (span_y - 1) / 2, dy - (span_y - 1) / 2 + span_y)) with &&
  )
);

create index hive_template_slots_template_idx
  on public.hive_formation_template_slots (template_id, ordinal);

create trigger hive_formation_templates_set_updated_at
  before update on public.hive_formation_templates
  for each row execute function public.set_updated_at();

create trigger hive_formation_templates_notify
  after insert or update or delete on public.hive_formation_templates
  for each statement execute function public.notify_topic_change('hive_formation_templates');
create trigger hive_template_slots_notify
  after insert or update or delete on public.hive_formation_template_slots
  for each statement execute function public.notify_topic_change('hive_formation_templates');

-- ONE ROW PER TEMPLATE, WITH ITS SIZE FOLDED IN. The standing rule: a query
-- feeding a screen that counts things must return one row per thing, because
-- PostgREST caps a response at 1,000 rows and drops the overflow in silence.
-- A picker that joined the slots would show nine templates and lose the
-- tenth once the shapes got big.
create view public.hive_formation_template_list
with (security_invoker = true)
as
select t.template_id,
       t.name,
       t.note,
       t.created_at,
       t.updated_at,
       coalesce(s.tiles, 0) as tiles,
       coalesce(s.bases, 0) as bases,
       coalesce(s.structures, 0) as structures
  from public.hive_formation_templates t
  left join lateral (
    select count(*)::int as tiles,
           count(*) filter (where ts.kind = 'base')::int as bases,
           count(*) filter (where ts.kind = 'structure')::int as structures
      from public.hive_formation_template_slots ts
     where ts.template_id = t.template_id
  ) s on true;

comment on view public.hive_formation_template_list is
  'One row per template with its tile counts folded in, so the number of rows '
  'is the number of templates and the picker cannot silently lose one.';

-- Saving a shape has the same problem saving a layout does (0167): the
-- exclusion constraint makes the halfway states of a rewrite invalid, so the
-- unit of writing is the whole template in one transaction.
--
-- Upsert by NAME rather than by id, because that is what the officer means.
-- Saving 'Bear rally' again after moving three tiles is a correction to the
-- shape they already have, not a second shape with the same name they would
-- then have to tell apart.
create function public.save_hive_formation_template(
  p_name text,
  p_note text,
  p_slots jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_id uuid;
  clash record;
begin
  if not public.has_permission('hive.plan') then
    raise exception 'saving a hive shape requires the hive.plan permission'
      using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'a saved shape needs a name' using errcode = '22023';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'the shape must be a json array of {dx, dy} objects'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) = 0 then
    raise exception 'there is nothing drawn to save' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_slots) as i(dx int, dy int)
     where i.dx is null or i.dy is null
  ) then
    raise exception 'every tile needs an integer dx and dy' using errcode = '22023';
  end if;

  -- The same intersection the constraint uses, said in language an officer
  -- can act on. Kept identical to 0170's so the friendly message and the
  -- guarantee cannot come to disagree about which shapes are legal.
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

  select template_id into v_template_id
    from public.hive_formation_templates
   where lower(btrim(name)) = lower(btrim(p_name));

  if v_template_id is null then
    insert into public.hive_formation_templates (name, note, created_by)
    values (btrim(p_name), coalesce(p_note, ''), auth.uid())
    returning template_id into v_template_id;
  else
    -- Emptied and refilled rather than reconciled. A template has no ids
    -- anything else points at, so there is nothing a diff would preserve —
    -- and the delete is what makes the refill's exclusion constraint pass.
    delete from public.hive_formation_template_slots
     where template_id = v_template_id;
    update public.hive_formation_templates
       set note = coalesce(p_note, note)
     where template_id = v_template_id;
  end if;

  insert into public.hive_formation_template_slots
    (template_id, dx, dy, span_x, span_y, kind, colour, label, ordinal)
  select v_template_id, i.dx, i.dy,
         coalesce(i.span_x, 3), coalesce(i.span_y, 3),
         coalesce(i.kind, 'base'), i.colour,
         coalesce(i.label, ''), coalesce(i.ordinal, 0)
    from jsonb_to_recordset(p_slots)
      as i(dx int, dy int, span_x int, span_y int, kind text, colour text,
           label text, ordinal int);

  return v_template_id;
end;
$$;

comment on function public.save_hive_formation_template(text, text, jsonb) is
  'Store a drawn shape under a name, replacing the shape already stored under '
  'that name. Carries no anchor, no server and nobody standing on the tiles.';

alter table public.hive_formation_templates enable row level security;
alter table public.hive_formation_template_slots enable row level security;

grant select, insert, update, delete on public.hive_formation_templates to authenticated;
grant select, insert, update, delete on public.hive_formation_template_slots to authenticated;
grant select on public.hive_formation_template_list to authenticated;
grant all on public.hive_formation_templates to service_role;
grant all on public.hive_formation_template_slots to service_role;

-- Reading by role, writing by capability, as everywhere else here. Members
-- read: a saved shape is what the plan they are about to be given was drawn
-- from, and there is nothing in one that the formation itself does not
-- already show them.
create policy member_read on public.hive_formation_templates
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));
create policy member_read on public.hive_formation_template_slots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy planner_insert on public.hive_formation_templates
  for insert to authenticated
  with check (public.has_permission('hive.plan'));
create policy planner_update on public.hive_formation_templates
  for update to authenticated
  using (public.has_permission('hive.plan'))
  with check (public.has_permission('hive.plan'));
create policy planner_delete on public.hive_formation_templates
  for delete to authenticated
  using (public.has_permission('hive.plan'));

create policy planner_insert on public.hive_formation_template_slots
  for insert to authenticated
  with check (public.has_permission('hive.plan'));
create policy planner_update on public.hive_formation_template_slots
  for update to authenticated
  using (public.has_permission('hive.plan'))
  with check (public.has_permission('hive.plan'));
create policy planner_delete on public.hive_formation_template_slots
  for delete to authenticated
  using (public.has_permission('hive.plan'));

grant execute on function public.save_hive_formation_template(text, text, jsonb)
  to authenticated;
