-- Remove seed.sql's synthetic players and alliance.
--
-- `supabase db reset` runs seed.sql, which invents 20 players
-- (game_uid 58000001..58000020) and one alliance so a fresh checkout has
-- something to render. Once a real capture is loaded they are noise: they
-- inflate the member count, and their alliance carries
-- roster_unredacted_seen, which is the evidence alliances.is_own falls back
-- to when no admin pin is set. Two "own" alliances is not a state the
-- dashboard has a sensible answer for.
--
-- Run after a reset + replay, never on a database that only has the seed —
-- there would be nothing left to look at.
--
--   Get-Content supabase\drop-synthetic-seed.sql |
--     docker exec -i supabase_db_darkwar-platform psql -U postgres -v ON_ERROR_STOP=1
--
-- The deletes are generated from pg_constraint rather than listed. Sixteen
-- tables reference players and only half carry ON DELETE CASCADE; a
-- hand-written list was wrong twice before this was written, and it will go
-- stale again the next time a table is added. FKs with confdeltype = 'c'
-- are skipped because they clean themselves up.
--
-- One DO block, so a constraint nobody anticipated rolls the whole thing
-- back instead of leaving half a player behind.

do $$
declare
  players_gone uuid[];
  alliances_gone uuid[];
  r record;
begin
  select array_agg(player_id) into players_gone
  from public.players where game_uid between 58000001 and 58000020;

  select array_agg(alliance_id) into alliances_gone
  from public.alliances where current_name like 'Synthetic%';

  if players_gone is not null then
    for r in
      select c.conrelid::regclass as child, a.attname as col
      from pg_constraint c
      join lateral unnest(c.conkey) as k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f' and c.confrelid = 'public.players'::regclass
        and c.confdeltype <> 'c'
    loop
      execute format('delete from %s where %I = any($1)', r.child, r.col)
        using players_gone;
    end loop;
    delete from public.players where player_id = any(players_gone);
  end if;

  if alliances_gone is not null then
    for r in
      select c.conrelid::regclass as child, a.attname as col
      from pg_constraint c
      join lateral unnest(c.conkey) as k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f' and c.confrelid = 'public.alliances'::regclass
        and c.confdeltype <> 'c'
    loop
      execute format('delete from %s where %I = any($1)', r.child, r.col)
        using alliances_gone;
    end loop;
    delete from public.alliances where alliance_id = any(alliances_gone);
  end if;

  raise notice 'removed % players, % alliances',
    coalesce(array_length(players_gone, 1), 0),
    coalesce(array_length(alliances_gone, 1), 0);
end $$;
