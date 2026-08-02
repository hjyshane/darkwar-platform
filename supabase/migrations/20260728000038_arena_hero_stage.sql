-- 0038: promote `stage` — the last decoded arena field that was being thrown
-- away on every observation.
--
-- The decoder has emitted ArmyUnit.stage since 0025 and arena.py never read
-- it, so it died between the two. That is the same shape of gap as
-- `al.battle.rank.info`, which was marked "promote" and never was; the
-- difference is only that this one lost data instead of leaving an empty
-- column, which is worse rather than better.
--
-- What it is: the promotion step toward the next star. Two independent
-- pieces of evidence, neither of them a screen reading:
--
--   init.userHero, 27 heroes on the collector's own account — the 23 at
--   rankLv 6 (the game's 5★ cap) have no `stage` KEY AT ALL, and only the
--   four below it carry one. This is JSON, so absence is real absence: the
--   server declines to send a stage for a hero that has no next star.
--
--   4,260 decoded arena units — all 2,196 at payload star 6 read 0, and the
--   1,414 below spread across 0-4.
--
-- Nullable rather than `not null default 0`, and the reason is the whole
-- point of the field. In proto3 an absent varint is 0, so the blob cannot
-- tell "step 0 of the next star" from "there is no next star". `star` can:
-- at the cap the value is meaningless, so it is written as null — unknown
-- stays unknown (FR-UI-008) instead of being flattened into a 0 that would
-- then average with the real zeros below the cap.
alter table public.arena_entry_heroes
  add column stage smallint;

comment on column public.arena_entry_heroes.stage is
  'Promotion step toward the next star, 0-4. Null at maximum star, where the '
  'payload sends nothing and the concept does not apply — not zero, which is '
  'a real step below the cap.';
