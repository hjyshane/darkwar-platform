-- 0165: a planned tile for every member, and the geometry that makes the plan
-- possible.
--
-- WHAT THIS IS FOR. A hive move or a war rally is decided in chat and executed
-- by eighty people each pressing teleport wherever looks free. The result is
-- never aligned: bases land on top of the ground somebody else was told to
-- take, the formation ends up three tiles adrift of the flag, and fixing it
-- costs another teleport item per person. The fix is to hand each member ONE
-- COORDINATE and nothing else to decide.
--
-- A BASE IS 3x3 TILES AND THE COORDINATE IS ITS CENTRE. That single fact is
-- what makes this a real problem rather than a list of numbers: the map is
-- addressed one tile at a time, so two centres one tile apart name two
-- different squares that are the SAME GROUND. Told to 500,500 and 501,500,
-- two members cannot both land — and the second one finds out in game, not
-- here. Centres must therefore be at least 3 apart on one axis or the other,
-- and that is a constraint the database can hold rather than a rule the
-- planner has to remember at every click.
--
-- WHY OFFSETS AND NOT ABSOLUTE COORDINATES. A formation is drawn once and
-- moved often — the hive relocates, the rally point shifts a screen east, the
-- same shape gets reused on a season map. Slots carry `dx, dy` from the
-- formation's anchor, so relocating eighty bases is one row's edit and the
-- shape is provably unchanged by it. The absolute coordinate a member is
-- actually told is anchor + offset, computed in 0166's view.
--
-- The consequence worth naming: NON-OVERLAP IS A PROPERTY OF THE OFFSETS
-- ALONE. The anchor is constant within a formation, so it cancels out of
-- every pairwise comparison, which is why the exclusion constraint below can
-- be written against dx and dy and still be true of the ground.

-- For the `formation_id with =` half of the exclusion constraint. gist has no
-- equality operator class for uuid on its own; btree_gist is what supplies
-- one. `with schema extensions` follows 0141's pg_trgm, and the opclass is
-- named schema-qualified at the constraint so resolution does not depend on
-- whose search_path the migration runs under.
create extension if not exists btree_gist with schema extensions;

create table public.hive_formations (
  formation_id uuid primary key default gen_random_uuid(),
  -- What the officer calls it in chat. "Hive move 09-12", "Bear rally".
  name text not null check (length(btrim(name)) > 0),
  -- The map this is drawn on. A formation is meaningless on another server:
  -- the same coordinate there is somebody else's ground entirely.
  server_id int not null references public.servers (server_id),

  -- THE ANCHOR IS A TILE, NOT A SLOT. Usually the flag, the rally point, or
  -- the centre of where the hive is going. Nothing has to sit on it — it is
  -- the origin the offsets are measured from, and moving it moves the whole
  -- formation.
  --
  -- Bounded 1..998 rather than 0..999 for the same reason a slot is: a 3x3
  -- base centred on the edge would need a row of tiles that does not exist.
  anchor_x int not null check (anchor_x between 1 and 998),
  anchor_y int not null check (anchor_y between 1 and 998),

  note text not null default '',

  -- The one members are being told to execute right now. A plan being drawn
  -- and a plan being followed are different things, and a member reading
  -- "where do I go" must not be shown a draft somebody is still moving
  -- around. At most one per server, enforced below.
  is_active boolean not null default false,

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hive_formations is
  'A hive or rally shape drawn on one server''s map. Slots are stored as '
  'offsets from the anchor, so relocating the formation is one edit and '
  'cannot change the shape.';

comment on column public.hive_formations.is_active is
  'The formation members are currently being told to execute. At most one '
  'per server: a draft being moved around must never be what somebody reads '
  'their teleport coordinate off.';

-- At most one live plan per map. A partial unique index rather than a check,
-- because "only one row may be true" is not a property of any single row.
create unique index hive_formation_one_active_per_server
  on public.hive_formations (server_id)
  where is_active;

create index hive_formations_server_idx
  on public.hive_formations (server_id, updated_at desc);

create table public.hive_formation_slots (
  slot_id uuid primary key default gen_random_uuid(),
  formation_id uuid not null
    references public.hive_formations (formation_id) on delete cascade,

  -- Offsets from the formation's anchor, in tiles. Signed: a formation is
  -- drawn around its anchor, not out from a corner.
  --
  -- The bound is the map's own width, which is what stops an offset that
  -- could never land anywhere no matter where the anchor sits. Whether a
  -- PARTICULAR anchor keeps this slot on the map is a second question, and
  -- the trigger below is where it is answered — a check constraint cannot
  -- read the parent row.
  dx int not null check (dx between -998 and 998),
  dy int not null check (dy between -998 and 998),

  -- Drawing order, and the order auto-assignment fills the slots in. Kept as
  -- a number the planner controls rather than derived from position: which
  -- slot the strongest member should take is a decision about the formation
  -- (front line, flag guard), and no ordering of x and y encodes it.
  ordinal int not null default 0,
  -- Free text on the tile — 'R5', 'flag', 'east gate'. Not a role and not
  -- validated: this is what one officer writes to be read by another.
  label text not null default '',

  -- Who is being sent here. Null is an empty slot, which is a normal state:
  -- a formation is usually drawn before it is filled.
  --
  -- `on delete set null` rather than cascade — a player row going away must
  -- empty the slot, not delete the ground.
  player_id uuid references public.players (player_id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references auth.users (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One slot per centre. Implied by the exclusion below, but named because
  -- it is what `on conflict` keys on when a layout is saved, and because a
  -- reader should not have to derive "no duplicates" from a range operator.
  unique (formation_id, dx, dy),

  -- THE CONSTRAINT THIS TABLE EXISTS FOR.
  --
  -- A base centred on dx covers dx-1, dx, dx+1. Two bases share ground when
  -- their x spans intersect AND their y spans do — which is exactly two
  -- centres less than 3 apart on both axes. Written as half-open int4ranges
  -- so the arithmetic is integer throughout: `int4range(dx - 1, dx + 2)` is
  -- the closed span [dx-1, dx+1], and `&&` on two of those is true only when
  -- they genuinely share a tile.
  --
  -- Centres 3 apart give [-1,1] and [2,4]: adjacent, touching, allowed —
  -- that is a packed hive. Centres 2 apart give [-1,1] and [1,3]: they share
  -- tile 1, refused. The old way of finding that out was that the second
  -- member's teleport failed.
  --
  -- gist rather than btree because `&&` is not an equality, and btree_gist
  -- for the formation_id half so two formations can occupy the same ground
  -- without colliding with each other.
  constraint hive_slots_do_not_overlap exclude using gist (
    formation_id extensions.gist_uuid_ops with =,
    (int4range(dx - 1, dx + 2)) with &&,
    (int4range(dy - 1, dy + 2)) with &&
  )
);

comment on table public.hive_formation_slots is
  'One 3x3 base position in a formation, as an offset from the anchor, with '
  'the member told to take it. The exclusion constraint is the point of the '
  'table: two slots may not share a tile.';

comment on column public.hive_formation_slots.dx is
  'Tiles east of the formation anchor, of the base''s CENTRE. The base '
  'covers dx-1..dx+1.';

-- A member stands in one place. Partial, because an empty slot is not a
-- member and any number of them may exist.
create unique index hive_slot_one_place_per_member
  on public.hive_formation_slots (formation_id, player_id)
  where player_id is not null;

create index hive_slots_formation_idx
  on public.hive_formation_slots (formation_id, ordinal, dx, dy);
-- "Where am I supposed to be" — the member's own question, asked without
-- knowing which formation is the live one.
create index hive_slots_player_idx
  on public.hive_formation_slots (player_id)
  where player_id is not null;

-- Whether a formation's slots all land on the map, checked from both sides.
--
-- Neither half can be a check constraint: a slot's absolute position needs
-- the parent's anchor, and an anchor's validity needs every child. Two
-- triggers over one function, so the rule is written once.
--
-- Nothing is written before the raise, so raising is safe here — unlike the
-- throttles this repo has been bitten by, there is no counter to erase.
create function public.hive_formation_fits_the_map()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bad record;
begin
  if tg_table_name = 'hive_formations' then
    select f.anchor_x + s.dx as x, f.anchor_y + s.dy as y
      into bad
      from public.hive_formation_slots s
      join public.hive_formations f on f.formation_id = s.formation_id
     where s.formation_id = new.formation_id
       and (f.anchor_x + s.dx not between 1 and 998
         or f.anchor_y + s.dy not between 1 and 998)
     limit 1;
  else
    select f.anchor_x + new.dx as x, f.anchor_y + new.dy as y
      into bad
      from public.hive_formations f
     where f.formation_id = new.formation_id
       and (f.anchor_x + new.dx not between 1 and 998
         or f.anchor_y + new.dy not between 1 and 998);
  end if;

  if found then
    raise exception
      'slot at %, % is off the map: a 3x3 base needs a centre between 1 and 998',
      bad.x, bad.y
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.hive_formation_fits_the_map() is
  'A slot''s absolute centre must leave room for its 3x3 footprint. Checked '
  'on the slot and again when the anchor moves, because moving the anchor is '
  'the operation that can push eighty slots off the world at once.';

-- AFTER, not BEFORE: the anchor check has to see the slots as they will be,
-- and a constraint trigger fires at the right moment for the slot half too.
create constraint trigger hive_slots_on_map
  after insert or update of dx, dy, formation_id on public.hive_formation_slots
  for each row execute function public.hive_formation_fits_the_map();

create constraint trigger hive_anchor_keeps_slots_on_map
  after update of anchor_x, anchor_y on public.hive_formations
  for each row execute function public.hive_formation_fits_the_map();

-- 0033's rule again: an author field the author can write is not an author
-- field.
create function public.hive_formations_set_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

-- Who put this member here, and when — stamped by the database rather than
-- sent by the client, for the same reason the author is. An assignment is
-- the row somebody argues about afterwards ("I was never told"), so the two
-- fields that answer it must not be writable by whoever is arguing.
--
-- Cleared when the slot is emptied: an assigned_at left behind on an empty
-- slot reads as an assignment that happened and did not.
create function public.hive_slots_stamp_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger hive_formations_set_updated_at
  before update on public.hive_formations
  for each row execute function public.set_updated_at();
create trigger hive_formations_actor
  before insert or update on public.hive_formations
  for each row execute function public.hive_formations_set_actor();

create trigger hive_slots_set_updated_at
  before update on public.hive_formation_slots
  for each row execute function public.set_updated_at();
create trigger hive_slots_assignment
  before insert or update on public.hive_formation_slots
  for each row execute function public.hive_slots_stamp_assignment();

-- Both tables under one topic. A slot moving and the anchor moving change the
-- same screen, and a reader watching a formation being drawn has no use for
-- knowing which of the two it was.
create trigger hive_formations_notify
  after insert or update or delete on public.hive_formations
  for each statement execute function public.notify_topic_change('hive_formations');
create trigger hive_slots_notify
  after insert or update or delete on public.hive_formation_slots
  for each statement execute function public.notify_topic_change('hive_formations');

alter table public.hive_formations enable row level security;
alter table public.hive_formation_slots enable row level security;

grant select, insert, update, delete on public.hive_formations to authenticated;
grant select, insert, update, delete on public.hive_formation_slots to authenticated;
grant all on public.hive_formations to service_role;
grant all on public.hive_formation_slots to service_role;

-- READING IS BY ROLE, WRITING IS BY CAPABILITY — 0045's line, and 0078
-- restates the reasoning. Every member reads: the whole feature is telling
-- eighty people where to go, and a plan only the officers can see is a plan
-- that gets executed wrong. Where the alliance is about to put its hive is
-- also exactly the thing a rival would like, so signed-out is not offered.
create policy member_read on public.hive_formations
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));
create policy member_read on public.hive_formation_slots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy planner_insert on public.hive_formations
  for insert to authenticated
  with check (public.has_permission('hive.plan'));
create policy planner_update on public.hive_formations
  for update to authenticated
  using (public.has_permission('hive.plan'))
  with check (public.has_permission('hive.plan'));
create policy planner_delete on public.hive_formations
  for delete to authenticated
  using (public.has_permission('hive.plan'));

create policy planner_insert on public.hive_formation_slots
  for insert to authenticated
  with check (public.has_permission('hive.plan'));
create policy planner_update on public.hive_formation_slots
  for update to authenticated
  using (public.has_permission('hive.plan'))
  with check (public.has_permission('hive.plan'));
create policy planner_delete on public.hive_formation_slots
  for delete to authenticated
  using (public.has_permission('hive.plan'));

-- One capability, not three. Drawing the shape and filling it are the same
-- job done by the same person in the same sitting, and a formation whose
-- slots somebody may move but not fill is not a useful half.
--
-- Officers hold it: a hive move is R4 business, and routing every tile
-- through an admin is how the plan arrives after the move.
insert into public.capabilities (capability, label, description, sort_order) values
  ('hive.plan', 'Plan a hive formation',
   'Draw the tiles of a hive or rally formation and assign members to them.', 110);

insert into public.role_permissions (role, capability, allowed)
select r.role, 'hive.plan', r.role in ('officer', 'admin')
from (values ('viewer'::public.app_role), ('member'), ('officer'), ('admin')) as r(role);
