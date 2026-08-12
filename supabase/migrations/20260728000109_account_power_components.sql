-- 0109: the other four power components, as registry rows — which is the whole
-- point of 0086. No schema change, no front-end change: ComponentTrend charts
-- whatever arrives with a registry label.
--
-- WHERE THE FIGURES COME FROM. `get.new.user.info` — the full profile card —
-- carries a six-way decomposition of total power: buildingPower, sciencePower,
-- armyPower, heroPower, modCarPower, petPower. Verified in the capture-sweep
-- runbook (2026-08-11) before promotion, per its own rule: across the last 400
-- journal rows, 97 distinct players carried all six fields (97/97, every value
-- an int), and on a 20-player sample the six sum to `power` EXACTLY, 20/20,
-- difference zero. A complete decomposition, not six loosely related figures.
--
-- ONLY FOUR ROWS, NOT SIX. heroPower and petPower already have metrics:
-- migration 0018 established selfPower == the profile's heroPower / petPower
-- exactly for boards 45 and 79, so the profile writes hero_power_total and
-- pet_power_total — the same fact observed by another route, with
-- source_command recording which route (the hero_power_best precedent, 0086).
insert into public.component_metrics (metric, label, family, role, visibility, sort_order, notes)
values
  ('building_power', 'Building power', 'account', 'total', 'member', 60,
   'Power from buildings. From get.new.user.info''s buildingPower — one of the '
   'six components that sum exactly to the profile''s total power (verified '
   '20/20 in the journal, 2026-08-11).'),
  ('science_power', 'Tech power', 'account', 'total', 'member', 70,
   'Power from tech research. From get.new.user.info''s sciencePower; part of '
   'the same verified six-way decomposition of total power.'),
  ('army_power', 'Troop power', 'account', 'total', 'member', 80,
   'Power from troops — the largest component for every sampled player. From '
   'get.new.user.info''s armyPower; part of the six-way decomposition.'),
  ('mod_car_power', 'Vehicle power', 'account', 'total', 'member', 90,
   'Power from the modified vehicle. From get.new.user.info''s modCarPower; '
   'part of the six-way decomposition.');
