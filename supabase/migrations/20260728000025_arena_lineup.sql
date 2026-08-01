-- 0025: the arena defence lineup, decoded.
--
-- `army` on every arena entry is a base64 protobuf holding the five heroes a
-- player defends with. It was stored nowhere and blanked out of fixtures as
-- an "opaque lineup blob" — a precaution taken before anyone had looked
-- inside. It parses completely from the wire format; see protocol/army.py for
-- the field map and how each meaning was established.
--
-- Five rows per entry, so this cannot be columns on arena_entries. It follows
-- the arena_entries/arena_snapshots parent-child shape exactly, including the
-- deterministic snapshot_id, so a replay keeps children pointed at the same
-- parent.
--
-- Readable by anyone, matching arena_entries: the arena Top100 is a public
-- board, cross-server and alliance-blind, and a defence lineup is what it
-- shows. This is not the alliance-internal category that 0020 and 0024 had to
-- wall off.

create table public.arena_entry_heroes (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null,
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  arena_entry_id uuid not null
    references public.arena_entries (snapshot_id) on delete cascade,
  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,

  slot int,
  hero_id int not null,
  troop_class int,
  hero_level int,
  star int,
  hero_power bigint,
  hero_uuid bigint,
  equipment int[] not null default '{}'
);

comment on table public.arena_entry_heroes is
  'One row per hero in an arena defence lineup, decoded from the entry''s '
  '`army` protobuf. Five per entry in every lineup observed.';

comment on column public.arena_entry_heroes.troop_class is
  '1 fighter, 2 shooter, 3 rider. The payload gives only the number; the '
  'labels were read off the game screen and confirmed against the collector''s '
  'own lineup. Constant per hero across every hero observed, so it describes '
  'the hero rather than a per-player choice. Not the same as players.career_* '
  'or the payload''s careerType, which is 0 for every player in every capture.';

comment on column public.arena_entry_heroes.hero_uuid is
  'Per-instance hero id (army field 2.6). Matches army.info''s heroUuid for '
  'the collector''s own account, which is how field 2.1 was pinned as heroId.';

-- server_id leads, as everywhere else: the group grows to 12/16/32/64.
create index arena_entry_heroes_server_captured_idx
  on public.arena_entry_heroes (server_id, captured_at desc);
create index arena_entry_heroes_entry_idx
  on public.arena_entry_heroes (arena_entry_id, slot);
create index arena_entry_heroes_player_captured_idx
  on public.arena_entry_heroes (player_id, captured_at desc)
  where player_id is not null;
-- "who else runs this hero" is the question this table exists to answer.
create index arena_entry_heroes_hero_idx
  on public.arena_entry_heroes (hero_id, captured_at desc);

alter table public.arena_entry_heroes enable row level security;

-- 0006's `grant all on all tables` applied to the tables that existed then,
-- so every table added since has to say this for itself or sync gets 42501 on
-- its first insert. 0009 and 0016 carry the same line.
grant all on public.arena_entry_heroes to service_role;

create policy public_read on public.arena_entry_heroes
  for select to anon, authenticated using (true);

create trigger arena_entry_heroes_notify
  after insert on public.arena_entry_heroes
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();
