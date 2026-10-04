-- 0217: hero levels join the upgrade-cost catalogue (item 4).
--
-- The client's `heroes_levelup` holds each level's experience, and a hero's
-- experience is Food one for one. `dw-collector game-catalog` now writes
-- them as kind 'hero', subject 'hero', by the level reached, cost
-- [{"type": "resource", "id": "24", "amount": ...}]. Checked against the
-- user's own table (2026-10-03): exact from level 2 to 170 except where
-- theirs rounds, and the game's runs on to 200.

alter table public.game_upgrade_steps drop constraint game_upgrade_steps_kind_check;
alter table public.game_upgrade_steps
  add constraint game_upgrade_steps_kind_check
  check (kind in ('building', 'research', 'vehicle_part', 'pet', 'hero'));
