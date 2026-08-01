-- 0026: the level the arena screen shows is not always the hero's own.
--
-- A hero in the training centre is raised to another level, and the blob
-- reports both: field 2.2 is what it reached on its own, 2.14 what the
-- training centre brings it to. That second number is the hero's real level —
-- the effect applies, it is not a display convenience. 0025 stored 2.2, so a
-- level-120 hero was recorded as level 1.
--
-- Pinned against a labelled capture of the arena's rank 1 (2026-08-01): the
-- screen shows 120 for all five heroes, 2.2 reads 120/90/1/70/1, and exactly
-- the four sitting in the training centre carry 2.14 = 120.
--
-- hero_level now holds the real level. The self-reached level is kept beside
-- it because the payload distinguishes the two, not because one counts for
-- less: a hero raised by the training centre is that level.

alter table public.arena_entry_heroes
  add column base_level int,
  add column level_synced boolean not null default false;

comment on column public.arena_entry_heroes.hero_level is
  'The hero''s actual level: the training-centre level (army field 2.14) when '
  'there is one, the self-reached level (2.2) otherwise. Both are real — a '
  'hero raised by the training centre fights at that level.';

comment on column public.arena_entry_heroes.base_level is
  'The level the hero reached on its own (army field 2.2). Equal to '
  'hero_level unless level_synced, and often 1 for a hero raised entirely by '
  'the training centre.';

comment on column public.arena_entry_heroes.level_synced is
  'True when the level comes from the training centre. Recorded because the '
  'payload distinguishes them, not as a caveat on hero_level.';
