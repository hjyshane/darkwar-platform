-- 0244: a login that carries no squads no longer erases the last known ones.
--
-- account_state_latest takes each player's newest snapshot. Some logins arrive
-- with every squad empty (hero_squads = four `heroes: []`) although the squads
-- are filled in the game: on 2026-10-07 both tracked accounts read empty at
-- 21:53 UTC after 3-4 filled squads at 02:01 on 10-06. The planner's hero cards
-- group by squad, so the newest snapshot emptied them.
--
-- hero_squads now comes from the newest snapshot of that player in which at
-- least one squad has a hero; every other column is still the newest snapshot's.
-- A player who has never had a filled squad keeps the newest (empty) value.
--
-- Trade-off: squads deliberately emptied in the game keep showing the last
-- filled arrangement until a login carries a filled one.
--
-- 0237's body, with hero_squads replaced.

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
  coalesce(
    (select f.hero_squads
       from public.account_state_snapshots f
      where f.player_id = s.player_id
        and exists (
          select 1 from jsonb_array_elements(f.hero_squads) q
           where jsonb_array_length(q -> 'heroes') > 0)
      order by f.captured_at desc
      limit 1),
    s.hero_squads) as hero_squads,
  s.vehicle,
  s.pets
from public.account_state_snapshots s
where s.player_id is not null
order by s.player_id, s.captured_at desc;
