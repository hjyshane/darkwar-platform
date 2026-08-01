-- 0025: arena lineups follow the snapshot conventions, cascade from their
-- entry, and are readable by anyone — matching arena_entries, because the
-- Top100 is a public cross-server board.
begin;
create extension if not exists pgtap with schema extensions;

-- 6 has_column + 1 col_is_unique + 4 assertions.
select plan(11);

select has_column('public', 'arena_entry_heroes', c.col,
  'arena_entry_heroes has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'arena_entry_heroes', 'idempotency_key',
  'lineup idempotency_key is unique');

create temp table _parent as
select
  (select snapshot_id from public.arena_entries limit 1) as entry_id,
  (select server_id from public.arena_entries limit 1) as server_id;

insert into public.arena_entry_heroes
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, arena_entry_id, server_id, game_uid,
   slot, hero_id, troop_class, hero_level, star, hero_power, hero_uuid, equipment)
select '00000000-0000-4000-8000-00000000e501', 'user.get.arena.info', 'test',
       'test:lineup:1', '2026-07-30T05:35:55Z',
       '00000000-0000-4000-8000-000000000c01', 580, p.entry_id, p.server_id,
       58000001, 3, 40001, 1, 200, 6, 6731000, 1374965744252634311,
       array[410100, 410200, 410300, 410400]
from _parent p;

select is((select troop_class from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'), 1,
  'troop class is stored as the number the payload gives');
select is((select equipment from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'),
          array[410100, 410200, 410300, 410400],
  'equipment survives as an array rather than four columns');

-- hero_uuid exceeds int4; it is the game's 64-bit instance id.
select is((select hero_uuid from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'), 1374965744252634311::bigint,
  'hero_uuid holds a 64-bit instance id without truncating');

-- Deleting the parent entry takes its lineup with it.
delete from public.arena_entries where snapshot_id = (select entry_id from _parent);
select is_empty($$ select * from public.arena_entry_heroes
                   where idempotency_key = 'test:lineup:1' $$,
  'a lineup does not outlive the entry it was decoded from');

select * from finish();
rollback;
