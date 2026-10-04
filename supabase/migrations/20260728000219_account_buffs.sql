-- 0219: an account's buffs, for the material calculator's times and costs.
--
-- The login response carries `effect`: the server's own total per effect id,
-- research, buildings, pets and the rest already summed (WonderingDuck,
-- 2026-10-03: 30070 Construction Speed 73.14, 30071 Research Speed 82.01,
-- 30421 Reduce Construction Cost 14.5). Timed buffs — presidential, emergency
-- projects, event boosts — are not in that total; they arrive in `status`
-- with a window, kept here as timed_effects. Checked: a 4d15h build in the
-- user's own table is the game's 7d23h base over 1 + 73.14%.
--
-- Per account, like the rest of account state: two accounts log in on this
-- PC and their totals alternate in the journal. Owner-or-admin read (0205).
--
-- game_effects names the ids, from the client's effect_num_des.

alter table public.account_state_snapshots
  add column effects jsonb not null default '{}'::jsonb,
  add column timed_effects jsonb not null default '[]'::jsonb;

-- Recreated with the two new columns at the end; the policy and grants of
-- the snapshot table still apply through security invoker.
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
  s.timed_effects
from public.account_state_snapshots s
where s.player_id is not null
order by s.player_id, s.captured_at desc;

create table public.game_effects (
  effect_id int primary key,
  name text,
  name_ko text,
  is_minus boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.game_effects is
  'Effect ids the server sums per account (init.effect) and their names, from '
  'the client''s effect_num_des (0219). Written by dw-collector game-catalog.';

alter table public.game_effects enable row level security;
revoke all on public.game_effects from anon, authenticated;
grant select on public.game_effects to authenticated;
grant all on public.game_effects to service_role;

create policy member_read on public.game_effects
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
