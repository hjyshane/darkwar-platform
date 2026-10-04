-- 0221: an account's resource stock at login, for the material planner.
--
-- The login response carries `resource`, the account's stock by key. The
-- parser (account_state 1.2.0) keeps the five that costs use, keyed by game
-- resource id like every cost in game_upgrade_steps: 25 Wood (sent as
-- `coal` — `wood` itself reads 0; confirmed in game 2026-10-04), 12 Iron,
-- 26 Electricity, 24 Food, 14 Coin. The planner starts its stock from it.
--
-- Per account, owner-or-admin read like the rest of account state (0205).

alter table public.account_state_snapshots
  add column resources jsonb not null default '{}'::jsonb;

-- Recreated with the new column at the end (0219's body plus resources); the
-- snapshot table's policy and grants still apply through security invoker.
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
  s.resources
from public.account_state_snapshots s
where s.player_id is not null
order by s.player_id, s.captured_at desc;
