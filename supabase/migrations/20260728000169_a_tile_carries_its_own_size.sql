-- 0169: a tile is whatever size it is, and Frankie stops being a special case.
--
-- 0165 built the whole thing around one number. A base is 3x3, so the
-- exclusion constraint was written `int4range(dx - 1, dx + 2)` and every
-- footprint in the app was that shape. Two things broke that:
--
--   FRANKIE IS 4x3. It stands on the anchor and it is not a base. The front
--   end grew a hardcoded CENTRE_BOX to keep members off its ground, which
--   meant the rule that actually matters — nothing overlaps anything — was
--   enforced in two places, in two languages, and only one of them was the
--   database.
--
--   THE MAP HAS OTHER THINGS ON IT. Alliance buildings, a 1x1 marker on a
--   tile somebody wants left clear, a rectangle of ground to keep empty. All
--   of those are "a shape at an offset that nothing may overlap", which is
--   what a slot already is once it stops assuming 3x3.
--
-- So the size moves onto the row and the constraint reads it. Frankie becomes
-- an ordinary slot with span 4x3, the special case disappears, and the rule is
-- back to being one rule in one place.
--
-- WHERE THE COORDINATE SITS IN AN EVEN SPAN. A 3-wide tile has a middle
-- column and a 4-wide one does not, so the convention has to be written down:
--
--     low = dx - (span - 1) / 2        (integer division, so it floors)
--     high = low + span - 1
--
-- For 3 that is dx-1..dx+1, the centre, unchanged. For 4 it is dx-1..dx+2 —
-- the coordinate is the WEST of the two middle columns. For 1 it is dx..dx,
-- the tile itself. The same arithmetic appears in TypeScript; both are driven
-- by the same rule rather than by two lists of cases.

alter table public.hive_formation_slots
  -- Tiles, not radius. A radius cannot say four.
  add column span_x int not null default 3 check (span_x between 1 and 32),
  add column span_y int not null default 3 check (span_y between 1 and 32),
  -- What it is for. A base holds a member; a structure holds ground.
  --
  -- Not inferred from the span: a 3x3 alliance building and a member's base
  -- are the same shape and mean opposite things, and "does this tile want a
  -- name in the assignment table" is not a question about geometry.
  add column kind text not null default 'base' check (kind in ('base', 'structure')),
  -- What the officer wants it to look like. Null is the default look, which
  -- is what almost every base stays. Stored as a token rather than a CSS
  -- colour so the stylesheet keeps deciding what the theme's red is — a hex
  -- value here would be a colour that does not change with the theme and
  -- cannot be checked for contrast.
  add column colour text check (colour in (
    'slate', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'));

comment on column public.hive_formation_slots.span_x is
  'Tiles east-west. The coordinate is at dx - (span_x - 1) / 2 from the west '
  'edge, so an odd span is centred and an even one sits one column west of '
  'the middle.';

comment on column public.hive_formation_slots.kind is
  'base: a member stands here. structure: ground that is spoken for — '
  'Frankie, an alliance building, a tile deliberately left clear. A structure '
  'never carries a player.';

-- A structure is ground, not a person. Without this the assignment table
-- could put a member on Frankie and the only thing stopping it would be the
-- screen not offering to.
alter table public.hive_formation_slots
  add constraint hive_structures_hold_nobody
  check (player_id is null or kind = 'base');

-- THE CONSTRAINT THAT WAS THE POINT OF THE TABLE, now reading the row's own
-- size instead of assuming everyone's is three.
--
-- Dropped and recreated rather than added alongside: two exclusion
-- constraints would both have to pass, and the old one would go on refusing
-- a 1x1 marker beside a base for a clash that does not exist.
alter table public.hive_formation_slots
  drop constraint hive_slots_do_not_overlap;

alter table public.hive_formation_slots
  add constraint hive_slots_do_not_overlap exclude using gist (
    formation_id extensions.gist_uuid_ops with =,
    (int4range(dx - (span_x - 1) / 2, dx - (span_x - 1) / 2 + span_x)) with &&,
    (int4range(dy - (span_y - 1) / 2, dy - (span_y - 1) / 2 + span_y)) with &&
  );

-- The map's edge, for a footprint that is no longer symmetric.
--
-- 0165 asked whether the CENTRE was between 1 and 998, which is the right
-- question only for a 3x3. A 1x1 may sit on 0, and a 4-wide one needs two
-- columns to its east. Rewritten to ask what it should have asked: is every
-- tile of the footprint on the map.
create or replace function public.hive_formation_fits_the_map()
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
       and not (
         int4range(0, 1000) @> int4range(
           f.anchor_x + s.dx - (s.span_x - 1) / 2,
           f.anchor_x + s.dx - (s.span_x - 1) / 2 + s.span_x)
         and int4range(0, 1000) @> int4range(
           f.anchor_y + s.dy - (s.span_y - 1) / 2,
           f.anchor_y + s.dy - (s.span_y - 1) / 2 + s.span_y)
       )
     limit 1;
  else
    select f.anchor_x + new.dx as x, f.anchor_y + new.dy as y
      into bad
      from public.hive_formations f
     where f.formation_id = new.formation_id
       and not (
         int4range(0, 1000) @> int4range(
           f.anchor_x + new.dx - (new.span_x - 1) / 2,
           f.anchor_x + new.dx - (new.span_x - 1) / 2 + new.span_x)
         and int4range(0, 1000) @> int4range(
           f.anchor_y + new.dy - (new.span_y - 1) / 2,
           f.anchor_y + new.dy - (new.span_y - 1) / 2 + new.span_y)
       );
  end if;

  if found then
    raise exception
      'the tile at %, % does not fit on the map: its footprint runs off the edge',
      bad.x, bad.y
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The slot trigger has to fire when the SIZE changes too: growing a 1x1 into
-- a 4x3 can push it off the edge without dx or dy moving at all.
drop trigger hive_slots_on_map on public.hive_formation_slots;
create constraint trigger hive_slots_on_map
  after insert or update of dx, dy, span_x, span_y, formation_id
  on public.hive_formation_slots
  for each row execute function public.hive_formation_fits_the_map();

comment on constraint hive_slots_do_not_overlap on public.hive_formation_slots is
  'No two tiles in a formation may share ground, whatever size each of them '
  'is. Reads span_x/span_y off the row rather than assuming 3x3, which is '
  'what lets Frankie (4x3), an alliance building and a 1x1 marker live in the '
  'same table as the members'' bases and be checked by the same rule.';
