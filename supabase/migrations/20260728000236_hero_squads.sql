-- 0236: the account's march squads.
--
-- The planner's hero cards group by squad (user 2026-10-05: squads 1-4, and
-- the heroes in none of them together). The login's army_formation names each
-- squad's heroes by instance uuid; the parser (account_state 1.5.0) maps them
-- to hero ids:
--   hero_squads  [{"index": 1, "heroes": [heroId, ...]}, ...]  slot order
-- Owner-or-admin read, like the rest of account state (0205).

alter table public.account_state_snapshots
  add column hero_squads jsonb not null default '[]'::jsonb;

-- 0231's body plus the column at the end.
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
  s.hero_squads
from public.account_state_snapshots s
where s.player_id is not null
order by s.player_id, s.captured_at desc;
