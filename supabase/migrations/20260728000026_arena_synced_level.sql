-- 0026: the level the arena screen shows is not always the hero's own.
--
-- A hero parked in the training centre is synced to another level, and the
-- blob reports both: field 2.2 is the hero's own, 2.14 the synced one. 0025
-- stored 2.2 and called it hero_level, so a hero the game displays at 120 was
-- recorded as level 1.
--
-- Pinned against a labelled capture of the arena's rank 1 (2026-08-01): the
-- screen shows 120 for all five heroes, 2.2 reads 120/90/1/70/1, and exactly
-- the four sitting in the training centre carry 2.14 = 120.
--
-- hero_level now holds what the screen shows. The hero's own level is kept
-- beside it rather than discarded, because "levelled to 120 directly" and
-- "parked at 1 and synced to 120" are different facts about a player, and
-- the second is invisible if only the displayed number survives.

alter table public.arena_entry_heroes
  add column base_level int,
  add column level_synced boolean not null default false;

comment on column public.arena_entry_heroes.hero_level is
  'The level the game displays: the training-centre synced level (army field '
  '2.14) when there is one, the hero''s own level (2.2) otherwise.';

comment on column public.arena_entry_heroes.base_level is
  'The hero''s own level (army field 2.2). Equal to hero_level unless '
  'level_synced, and often 1 for a hero never levelled directly.';

comment on column public.arena_entry_heroes.level_synced is
  'True when hero_level came from the training centre rather than the hero.';
