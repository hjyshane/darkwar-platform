-- 0044: the pet catalogue, for the same reason 0037 built the hero one.
--
-- `player_component_power_snapshots.unit_id` holds a hero id on the hero
-- boards and a pet id on the pet ones, and the cross-server board printed
-- whichever number it was. A pet id is no more meaningful on screen than a
-- hero id was, and for the same reason: the protocol carries no names.
--
-- A table rather than a constant beside TROOP_CLASSES, again because the
-- list grows — 107 shipped recently, which is exactly the case that makes a
-- constant a commit, a review and a deploy to write down something somebody
-- already read off their screen.
--
-- Separate from `heroes` rather than a `kind` column on it: a pet has no
-- troop class and no 등급, and half a table of nulls is not a shared shape.
create table public.pets (
  pet_id integer primary key,
  name text check (name is null or length(btrim(name)) > 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pets is
  'Pet id to display name, typed by an admin — the protocol carries no names '
  'for pets any more than for heroes. Seeded from what the user read in game.';

create unique index pets_name_key
  on public.pets (lower(name))
  where name is not null;

alter table public.pets enable row level security;

grant select on public.pets to anon, authenticated;
grant insert, update, delete on public.pets to authenticated;
grant all on public.pets to service_role;

create policy public_read on public.pets
  for select to anon, authenticated
  using (true);

create policy admin_write on public.pets
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create trigger pets_set_updated_at
  before update on public.pets
  for each row execute function public.set_updated_at();

create trigger pets_notify
  after insert or update or delete on public.pets
  for each statement execute function public.notify_topic_change('pets');

-- The seed. Names and their ORDER came from the user, hedged as "probably
-- in order", and that hedge is the reason this is a table with an admin form
-- behind it rather than a constant. Only two pet ids have ever been observed
-- (105 and 106, the second on 149 of 150 rows of the best-pet board), so the
-- captures cannot check the other five.
--
-- If the order is off, it is off by a rotation and every name is wrong
-- together, which is the failure mode worth knowing about: a single wrong
-- name looks like a typo, a rotated list looks like data.
insert into public.pets (pet_id, name, notes) values
  (101, 'Sentinel', 'order unconfirmed'),
  (102, 'Shining',  'order unconfirmed'),
  (103, 'Zeus',     'order unconfirmed'),
  (104, 'Specter',  'order unconfirmed'),
  (105, 'Frost',    'observed once on the best-pet board'),
  (106, 'Titan',    'observed on 149 of 150 rows — effectively the meta pick'),
  (107, 'Regulus',  'added recently');
