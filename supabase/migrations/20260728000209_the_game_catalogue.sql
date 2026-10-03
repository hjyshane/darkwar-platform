-- What the game's items and resources are called, and what each level of
-- each upgradeable thing costs — read from the game client's own tables.
--
-- The server sends numbers. The client names them, and prices every upgrade,
-- from datatables it ships and downloads; `dw-collector game-catalog` reads
-- those (docs/runbooks/game-data.md, gamedata/catalog.py) and writes here.
-- Checked against the main account's captured login before any of it was
-- trusted: its 53 buildings, 247 of 248 research entries and 159 inventory
-- items all join these tables.
--
-- This is the material planner's price list (item 4) and the pack report's
-- item dictionary (item 3). It is the game's, not the alliance's: every member
-- reads it, and only the collector's key writes it. A game update means
-- re-running the command, which upserts in place.
--
-- costs is one shape whatever table it came from:
--   [{"type": "resource" | "item", "id": "25", "amount": 11400}, ...]
-- `type` matters: resource 25 (Wood) and item 25 are different things.

create table public.game_items (
  item_id text primary key check (item_id ~ '^[0-9]+$'),
  name text,
  name_ko text,
  item_type int,
  quality int,
  icon text,
  updated_at timestamptz not null default now()
);

create table public.game_resources (
  resource_id int primary key,
  name text,
  name_ko text,
  updated_at timestamptz not null default now()
);

create table public.game_upgrade_steps (
  kind text not null check (kind in ('building', 'research', 'vehicle_part', 'pet')),
  -- building: the building type (id rounded down to the thousand);
  -- research: science_id; vehicle_part: slot; pet: rarity.
  subject_id text not null,
  level int not null,
  name text,
  name_ko text,
  costs jsonb not null default '[]'::jsonb check (jsonb_typeof(costs) = 'array'),
  seconds bigint,
  power bigint,
  updated_at timestamptz not null default now(),
  primary key (kind, subject_id, level)
);

do $$
declare
  t text;
begin
  foreach t in array array['game_items', 'game_resources', 'game_upgrade_steps'] loop
    execute format('alter table public.%I enable row level security', t);
    -- revoke-then-grant: the hosted project's default privileges hand
    -- authenticated everything, TRUNCATE included (0207).
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format(
      'create policy member_read on public.%I for select to authenticated
         using ((select public.current_app_role()) in (''member'', ''officer'', ''admin''))',
      t);
  end loop;
end
$$;
