-- 0171: the shapes an officer draws over and over, kept as a list.
--
-- 0169 made a tile carry its own size, kind and colour, and the editor grew
-- three hardcoded presets to put those in reach: a 3x3 base, Frankie at 4x3,
-- a 1x1 marker. Three is what fits in a source file. The map has more than
-- three things on it — the alliance HQ, the depot, a rally flag, a patch of
-- ground somebody wants left clear for the next wave — and an officer who
-- has to retype "6 wide, 4 tall, teal" every time they draw one will draw it
-- wrong once and not notice.
--
-- So the presets stop being code. A feature here is a NAME AND A SHAPE, and
-- nothing else: no position, no formation, no server.
--
--   NO POSITION. The catalogue says an alliance HQ is 3x3; where this
--   alliance's HQ stands is a fact about one formation on one map, and it
--   lives in hive_formation_slots where every other placed tile lives. A
--   catalogue that also stored coordinates would have to be re-entered for
--   every formation, which is the retyping this exists to stop.
--
--   NO SERVER. The same building is the same size on all eight maps — the
--   shape is a fact about the game, not about 580. A formation is
--   server-scoped (0165) because a coordinate there means somebody else's
--   ground here; a size means the same thing everywhere.
--
-- What a click actually puts down is still a slot. This table is only what
-- the brush is loaded from, which is why it has no foreign key from
-- hive_formation_slots and why renaming an entry does not go back and rename
-- tiles already drawn: the label was copied onto the tile at the moment it
-- was placed, and a formation an officer has already sent to eighty people
-- must not change under them because somebody tidied the catalogue.

create table public.hive_map_features (
  feature_id uuid primary key default gen_random_uuid(),

  -- What the officer calls it when they say it out loud. This is copied onto
  -- the tile's label when the feature is placed, so it has to read as a
  -- caption on a small square: 'Alliance HQ', 'Depot', 'Flag'.
  name text not null check (length(btrim(name)) > 0),

  -- The shape, in the same terms and with the same bounds as a slot's. The
  -- coordinate sits at `- (span - 1) / 2` from the west/north edge, so an odd
  -- span is centred and an even one sits one tile west or north of the middle
  -- — 0169 sets that convention out in full and this table does not get its
  -- own.
  span_x int not null default 3 check (span_x between 1 and 32),
  span_y int not null default 3 check (span_y between 1 and 32),

  -- Almost always a structure: the point of the catalogue is the ground that
  -- is not a member's base. 'base' is still allowed, for the alliance that
  -- runs a second base size and wants it in reach.
  kind text not null default 'structure' check (kind in ('base', 'structure')),

  -- The same eight tokens hive_formation_slots.colour allows, and it has to
  -- stay the same eight: a feature carrying a colour the slot refuses would
  -- be a catalogue entry that cannot be placed. Deliberately NOT a shared
  -- domain — a domain type on a PostgREST column generates differently from a
  -- text one and this repo has already spent a day on a types diff — so the
  -- list is repeated here and 91's test asserts the two constraints are
  -- textually the same constraint.
  colour text check (colour in (
    'slate', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),

  -- Why it is in the list. 'Leave clear for the second wave', 'R4 only'.
  note text not null default '',

  -- What order the buttons come in. A number the officer controls, because
  -- the three they place forty times a night are not alphabetically first.
  sort_order int not null default 100,

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hive_map_features is
  'Reusable shapes for the formation editor''s brush: a name and a size for '
  'each thing that gets drawn on a map more than once. Carries no position '
  'and no server — where one stands is a slot in a formation, and a size is '
  'the same on every map.';

comment on column public.hive_map_features.name is
  'Copied onto a slot''s label when the feature is placed. Renaming an entry '
  'does not rename tiles already drawn: a formation already sent out must not '
  'change because the catalogue was tidied.';

-- One entry per thing. Two rows called 'Alliance HQ' with different sizes is
-- not a choice somebody made, it is the same thing entered twice, and the
-- brush would offer both without saying which is right.
create unique index hive_map_features_one_per_name
  on public.hive_map_features (lower(btrim(name)));

create index hive_map_features_order_idx
  on public.hive_map_features (sort_order, name);

create trigger hive_map_features_set_updated_at
  before update on public.hive_map_features
  for each row execute function public.set_updated_at();

-- Its own topic rather than riding hive_formations'. The catalogue and the
-- formation change at different moments for different reasons, and a rename
-- here has no business refetching eighty assignments.
create trigger hive_map_features_notify
  after insert or update or delete on public.hive_map_features
  for each statement execute function public.notify_topic_change('hive_map_features');

alter table public.hive_map_features enable row level security;

grant select, insert, update, delete on public.hive_map_features to authenticated;
grant all on public.hive_map_features to service_role;

-- Reading by role, writing by capability — 0045's line, and the same split
-- 0165 uses for the formations themselves. Every member reads: the catalogue
-- is what the labels on the tiles they are reading came from, and a member
-- who can see 'Depot' on the board should be able to see what a depot is.
create policy member_read on public.hive_map_features
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

-- No new capability. Adding 'the alliance HQ is 3x3' to the list and drawing
-- it on the map are the same job in the same sitting, and an officer who may
-- place a shape but not name one would keep a private list somewhere worse.
create policy planner_insert on public.hive_map_features
  for insert to authenticated
  with check (public.has_permission('hive.plan'));
create policy planner_update on public.hive_map_features
  for update to authenticated
  using (public.has_permission('hive.plan'))
  with check (public.has_permission('hive.plan'));
create policy planner_delete on public.hive_map_features
  for delete to authenticated
  using (public.has_permission('hive.plan'));

-- The three the editor had hardcoded, now rows like any other. Seeded rather
-- than left to the first officer because an empty list looks broken, and
-- these three are the ones every formation uses.
--
-- Ordinary rows: they can be renamed, resized or deleted. Deleting the base
-- entry does not take the 3x3 brush away — the editor's default brush is
-- still 3x3 in code, and the catalogue only ever loads it.
insert into public.hive_map_features (name, span_x, span_y, kind, colour, note, sort_order)
values
  ('Member base', 3, 3, 'base', null,
   'The default. One member stands here.', 10),
  ('Frankie', 4, 3, 'structure', 'amber',
   'Four wide, three tall, on the anchor. The coordinate is the west of the '
   'two middle columns.', 20),
  ('Keep clear', 1, 1, 'structure', 'red',
   'One tile nobody may build on.', 30);
