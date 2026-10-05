-- 0231: an account's real hero levels, and which heroes the Training Center
-- holds.
--
-- The planner showed hero_intensify (heroIntensifys[].lv) as the hero level,
-- and it is another figure: hero 1006 is level 96 in game and 10 there. The
-- level is userHero[].lev. A hero without a lev is in the Training Center,
-- which holds it at the lowest level among the five highest heroes outside
-- it — Katrina, with no lev, reads 130 beside a top five of
-- 131/131/130/130/130; Eddie's own 40 stands (user, 2026-10-04). The parser
-- (account_state 1.4.0) fills both:
--   hero_levels   {"<heroId>": level}, trained heroes at the synced level
--   hero_trained  ["<heroId>", ...] the ones the Training Center holds
-- Owner-or-admin read, like the rest of account state (0205).

alter table public.account_state_snapshots
  add column hero_levels jsonb not null default '{}'::jsonb,
  add column hero_trained jsonb not null default '[]'::jsonb;

-- Recreated with the two columns at the end (0222's body plus them); the
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
  s.resources,
  s.hero_exclusives,
  s.hero_levels,
  s.hero_trained
from public.account_state_snapshots s
where s.player_id is not null
order by s.player_id, s.captured_at desc;
