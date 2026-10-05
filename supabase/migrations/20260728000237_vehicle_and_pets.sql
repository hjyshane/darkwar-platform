-- 0237: the vehicle and pets, for the planner and My character.
--
-- From the login (account_state 1.6.0):
--   vehicle  {"level": 279, "exp": 1200, "suit_level": 27}
--   pets     [{"pet_id", "level", "breakthrough", "training": {attr: value}}]
-- From the client (game-catalog):
--   game_upgrade_steps kind 'vehicle'   subject 0, the vehicle's own level
--                      kind 'pet_break' subject the pet's rarity, at the
--                                       level the breakthrough lifts
--   pets.rarity        what a pet's level and breakthrough costs are keyed by
-- Owner-or-admin read for account state, like the rest of it (0205).

alter table public.account_state_snapshots
  add column vehicle jsonb not null default '{}'::jsonb,
  add column pets jsonb not null default '[]'::jsonb;

-- 0236's body plus the two columns at the end.
create or replace view public.account_state_latest
with (security_invoker = true) as
select distinct on (s.player_id)
  s.player_id,
  s.server_id,
  s.game_uid,
  s.captured_at,
  s.items,
  s.buildings,
  s.hero_equips,
  s.hero_intensify,
  s.mod_car_equips,
  s.science,
  s.effects,
  s.timed_effects,
  s.resources,
  s.hero_exclusives,
  s.hero_levels,
  s.hero_trained,
  s.hero_squads,
  s.vehicle,
  s.pets
from public.account_state_snapshots s
where s.player_id is not null
order by s.player_id, s.captured_at desc;

alter table public.game_upgrade_steps drop constraint game_upgrade_steps_kind_check;
alter table public.game_upgrade_steps
  add constraint game_upgrade_steps_kind_check
  check (kind in (
    'building', 'research', 'vehicle_part', 'vehicle', 'pet', 'pet_break',
    'hero', 'hero_gear', 'exclusive'
  ));

alter table public.pets add column rarity smallint check (rarity between 1 and 4);
