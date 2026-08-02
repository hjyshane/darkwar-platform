-- 0025: arena lineups follow the snapshot conventions, cascade from their
-- entry, and are readable by anyone — matching arena_entries, because the
-- Top100 is a public cross-server board.
begin;
create extension if not exists pgtap with schema extensions;

-- 6 has_column + 1 col_is_unique + 9 assertions, + 2 for `stage` (0038).
select plan(18);

select has_column('public', 'arena_entry_heroes', c.col,
  'arena_entry_heroes has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'arena_entry_heroes', 'idempotency_key',
  'lineup idempotency_key is unique');

-- 0038. The column is pinned along with its nullability, because the
-- nullability is the finding: a hero at maximum star has no next step, and
-- writing that as 0 would be indistinguishable from a hero below the cap
-- who has not started one. A NOT NULL here would force exactly that.
select has_column('public', 'arena_entry_heroes', 'stage',
  'the promotion step is stored rather than decoded and dropped');
select col_is_null('public', 'arena_entry_heroes', 'stage',
  'and it is nullable, because at maximum star there is no step to record');

create temp table _parent as
select
  (select snapshot_id from public.arena_entries limit 1) as entry_id,
  (select server_id from public.arena_entries limit 1) as server_id;

insert into public.arena_entry_heroes
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, arena_entry_id, server_id, game_uid,
   slot, hero_id, troop_class, hero_level, max_level, star, hero_power,
   hero_uuid, weapon_level, skills, equipment, troop_type_id, troop_count, raw,
   base_level, level_synced)
select '00000000-0000-4000-8000-00000000e501', 'user.get.arena.info', 'test',
       'test:lineup:1', '2026-07-30T05:35:55Z',
       '00000000-0000-4000-8000-000000000c01', 580, p.entry_id, p.server_id,
       58000001, 3, 40001, 1, 103, 200, 6, 6731000, 1374965744252634311, 26,
       '[{"skill_id": 10042150, "level": 15}]'::jsonb,
       '[{"equipment_id": 410100, "level": 100, "step": 11}]'::jsonb,
       '107009', 11201, '{"field_9": [2]}'::jsonb, 1, true
from _parent p;

select is((select troop_class from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'), 1,
  'troop class is stored as the number the payload gives');
select is((select equipment -> 0 ->> 'level' from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'), '100',
  'equipment keeps its level, not just the id');
select is((select skills -> 0 ->> 'skill_id' from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'), '10042150',
  'skills are stored per hero with their levels');

-- The level and the cap are different fields in the blob and must stay
-- different columns: reading the cap would store 200 for every player.
select is((select hero_level from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'), 103,
  'hero_level is the level, not the cap');
select is((select max_level from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'), 200,
  'the cap is kept alongside it');

-- 0026: a training-centre hero is displayed at a synced level while its own
-- stays where it was. Both are kept, because "levelled to 103" and "parked at
-- 1 and synced to 103" are different facts about a player.
select is((select base_level::text || '/' || level_synced::text
           from public.arena_entry_heroes where idempotency_key = 'test:lineup:1'),
          '1/true',
  'the hero''s own level survives beside the displayed one');

-- Fields the parser does not interpret have to survive somewhere.
select is((select raw ->> 'field_9' from public.arena_entry_heroes
           where idempotency_key = 'test:lineup:1'), '[2]',
  'uninterpreted army fields land in raw rather than being dropped');

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
