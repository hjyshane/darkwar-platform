-- 0022: pin the handful of players, alliances and servers you actually watch.
--
-- Three nullable foreign keys with a "exactly one" check, rather than a
-- (kind text, ref text) pair. The polymorphic shape is shorter to write and
-- gives up the thing worth having: a favourite pointing at a player who was
-- later merged away stays pointing at nothing, silently, and no constraint
-- notices. Real references let the database delete the favourite with the
-- row it referred to.
--
-- Keyed on auth.users, not app_users: someone can favourite a player before
-- an officer has admitted them to the alliance, and app_users has no row
-- until then.
--
-- server_id is here although nothing sets it yet. The server drill-down it
-- belongs to is the next piece of work; the column costs nothing now and
-- adding it later would mean a second migration to the same table.

create table public.favourites (
  favourite_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid references public.players (player_id) on delete cascade,
  alliance_id uuid references public.alliances (alliance_id) on delete cascade,
  server_id int references public.servers (server_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favourites_exactly_one_target check (
    (player_id is not null)::int
    + (alliance_id is not null)::int
    + (server_id is not null)::int = 1
  )
);

comment on table public.favourites is
  'Per-user shortcuts. Private to their owner: the RLS policy is the only '
  'thing standing between one member''s list and another''s.';

-- Partial indexes rather than one unique over all four columns: with nulls
-- in three of them, a plain unique constraint would let the same player be
-- favourited repeatedly on most Postgres versions.
create unique index favourites_player_uniq
  on public.favourites (user_id, player_id) where player_id is not null;
create unique index favourites_alliance_uniq
  on public.favourites (user_id, alliance_id) where alliance_id is not null;
create unique index favourites_server_uniq
  on public.favourites (user_id, server_id) where server_id is not null;

alter table public.favourites enable row level security;

grant select, insert, delete on public.favourites to authenticated;

-- One policy for read and write. `using` keeps other people's rows out of
-- your results; `with check` keeps you from writing rows into someone
-- else's list — a policy with only the first would allow exactly that.
create policy own_favourites on public.favourites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
