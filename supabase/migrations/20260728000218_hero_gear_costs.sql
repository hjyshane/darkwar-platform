-- 0218: hero gear joins the upgrade-cost catalogue (item 4).
--
-- Two tracks, as the user described them on 2026-10-03 and the client's
-- tables hold them. Levels (ds_equip_upgrade): Boost Ore per level, one list
-- per gear quality, subject 'level:q<quality>' (orange to 100: 144,300 Boost
-- Ore). Stages after level 100 (ds_equip_promote): ten stage-ups in Power
-- Core, then awakening in Power Core and Boost Ore with DX-Blueprint every
-- fifth step, subject 'promote'. Stored by the level reached.

alter table public.game_upgrade_steps drop constraint game_upgrade_steps_kind_check;
alter table public.game_upgrade_steps
  add constraint game_upgrade_steps_kind_check
  check (kind in ('building', 'research', 'vehicle_part', 'pet', 'hero', 'hero_gear'));
