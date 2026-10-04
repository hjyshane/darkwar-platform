-- 0230: game_hero_rarity (0229) goes.
--
-- It held aps_new_heroes.rarity, read as the hero grade the game colours —
-- and it is not that: rarity 1 takes in Corleone, Natasha, Megan and
-- Bumblebee alongside Katrina and Selwyn (user, 2026-10-04). The grade the
-- game shows is the hero catalogue's own heroes.grade (1 blue, 2 purple,
-- 3 yellow), set by hand on the admin page and already read by Arena; the
-- planner reads that now, and nothing reads this.

drop table public.game_hero_rarity;
