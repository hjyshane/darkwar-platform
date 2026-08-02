-- 0037: the hero catalogue — the one table whose contents the wire cannot fill.
--
-- Every other reference in this schema is either observed or derived. This
-- one is half and half, and the split is the reason it exists:
--
--   hero_id     observed. 28 distinct ids across 4,260 decoded arena units
--               and the collector's own init.userHero.
--   troop_class observed. Each heroId carries exactly one class in all 4,260
--               units — no id was ever seen as two classes — so the 24 that
--               have appeared in somebody's lineup are seeded from that
--               evidence. The other four have never been fielded by anyone
--               observed and are left null rather than guessed.
--   name        NOT observed, and never will be. The server sends
--               localisation keys, not text: push.refresh.hero.lottery
--               carries "name": "483491" beside "protect_des": "157000",
--               and heroId 1004 appears in rank.get.by.range attached to 50
--               different names, all of them player names. The display text
--               lives in the APK and resolves client-side. So a human types
--               these in, once, and that is not a shortcoming of the capture.
--
-- Why a table and not a constant beside TROOP_CLASSES in troops.ts, which is
-- where the class labels live: a new hero ships every season. In code that
-- is a commit, a review and a deploy to record a fact somebody already read
-- off their screen. Here it is a row, typed on the admin page, by the person
-- who saw it.

create table public.heroes (
  -- The game's own id, not a surrogate. It is what the payload carries and
  -- what arena_entry_heroes joins on, and it is stable across seasons.
  hero_id integer primary key,

  -- Null until an admin fills it in. Null is not "unnamed" — every hero has
  -- a name on screen — it is "nobody has typed it yet", and the UI says so
  -- by falling back to the id rather than showing a blank.
  name text check (name is null or length(btrim(name)) > 0),

  -- Deliberately not `check (troop_class in (1, 2, 3))`. troops.ts renders an
  -- unseen class as itself on the grounds that a fourth class would be news;
  -- a constraint here would make that news arrive as a failed insert on the
  -- admin page instead, and require a migration to write down something the
  -- game had already shipped.
  troop_class smallint check (troop_class is null or troop_class > 0),

  -- Free text for the things a catalogue always accumulates: which season it
  -- came from, which banner, "same kit as 22002". Not parsed by anything.
  notes text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.heroes is
  'Hero id to display name. Names are typed by an admin because the protocol '
  'carries localisation keys rather than text; classes are seeded from '
  'observed arena lineups. New heroes are added as rows, not as migrations.';

comment on column public.heroes.name is
  'Null means not yet named, not unnamed. Callers fall back to the hero_id.';

comment on column public.heroes.troop_class is
  'Matches arena_entry_heroes.troop_class. Seeded from observation where a '
  'hero has been fielded; null where nobody observed has ever played it.';

-- Catches the realistic mistake, which is not a name collision in the game
-- but the same name typed into two rows while filling the table in one
-- sitting. Case-insensitive for the same reason. Null names do not collide.
create unique index heroes_name_key
  on public.heroes (lower(name))
  where name is not null;

alter table public.heroes enable row level security;

-- Read is open. A hero's name is printed on the game's own recruit screen —
-- there is nothing here that alliance membership should gate, and the arena
-- board that consumes it is already readable.
grant select on public.heroes to anon, authenticated;
-- The grant is the half that 0032 left out: a policy that permits a write
-- cannot help a role that was never granted the write. The negative test
-- passed anyway, because it only asked whether a member was refused.
grant insert, update, delete on public.heroes to authenticated;
grant all on public.heroes to service_role;

create policy public_read on public.heroes
  for select to anon, authenticated
  using (true);

create policy admin_write on public.heroes
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create trigger heroes_set_updated_at
  before update on public.heroes
  for each row execute function public.set_updated_at();

-- Renaming a hero has to reach the arena board, and so does deleting one —
-- the board falls back to printing the id, and a reader watching a lineup
-- should see that happen rather than keep a name that no longer exists.
--
-- notify_data_change() cannot do this: it reads a `new_rows` transition
-- table and a server_id off it, and a hero has no server while a DELETE has
-- no new rows. 0034 hit the same wall and wrote a one-topic function for
-- itself; this is that function with the topic passed in, and announcements
-- moves onto it below rather than leaving two copies of six lines.
create function public.notify_topic_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.data_change_notifications (topic, server_id, payload)
  values (tg_argv[0], null, jsonb_build_object('op', tg_op));
  return null;
end;
$$;

create trigger heroes_notify
  after insert or update or delete on public.heroes
  for each statement execute function public.notify_topic_change('heroes');

drop trigger announcements_notify on public.announcements;
drop function public.notify_announcement_change();
create trigger announcements_notify
  after insert or update or delete on public.announcements
  for each statement execute function public.notify_topic_change('announcements');

-- The seed. Ids and classes only — see the header for why no names.
--
-- The count each class rests on is in the comment, because "Fighter" here is
-- a claim about evidence and one sighting is a weaker claim than 695. The
-- four nulls are heroes the collector owns but nobody observed has fielded,
-- and 33005 is the reverse: fielded six times by other players and absent
-- from the collector's own roster, which is what settled the question of
-- whether one account's hero list is the whole catalogue. It is not.
insert into public.heroes (hero_id, troop_class) values
  ( 1002, 1),  -- Fighter, 39
  ( 1003, 2),  -- Shooter, 162
  ( 1004, 1),  -- Fighter, 603
  ( 1006, 1),  -- Fighter, 695
  ( 1007, 1),  -- Fighter, 1
  ( 1008, 1),  -- Fighter, 175
  ( 1011, 1),  -- Fighter, 1
  ( 1012, 3),  -- Rider, 188
  ( 1015, null),  -- owned, never fielded
  ( 1016, 3),  -- Rider, 3
  ( 1017, 1),  -- Fighter, 263
  ( 1018, 2),  -- Shooter, 20
  ( 1019, 2),  -- Shooter, 7
  ( 1021, null),  -- owned, never fielded
  (11001, 2),  -- Shooter, 277
  (12001, 1),  -- Fighter, 59
  (21001, 2),  -- Shooter, 418
  (22001, 3),  -- Rider, 28
  (22002, 3),  -- Rider, 155
  (22003, 3),  -- Rider, 1
  (32001, null),  -- owned, never fielded
  (33001, 3),  -- Rider, 80
  (33002, null),  -- owned, never fielded
  (33003, 3),  -- Rider, 185
  (33005, 1),  -- Fighter, 6 — fielded by others, not owned by the collector
  (40001, 1),  -- Fighter, 502
  (40002, 2),  -- Shooter, 302
  (40003, 3);  -- Rider, 90
