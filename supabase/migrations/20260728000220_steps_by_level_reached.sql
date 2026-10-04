-- 0220: every upgrade step by the level it reaches, building prerequisites,
-- and hero gear by name and quality — for the material planner (item 4).
--
-- 0209 stored buildings, vehicle parts and pets by the client row's own
-- level, and each of those rows holds the cost of going ON to the next
-- level (the top row has none). Research, hero levels and hero gear are by
-- the level reached. A planner adding "from 30 to 35" across both would be
-- off by one on half of them, so `dw-collector game-catalog` now writes all
-- kinds by the level reached; the old rows of the shifted kinds are cleared
-- here and come back on the next catalogue run. Checked: the step reaching
-- Watchtower 31 is 96M wood, iron and electricity each plus 180 Precision
-- Parts, needs Alliance Hall 30 and Fighter Camp 30 — the user's own table.
--
-- requires: [{"subject": "402000", "level": 30}, ...] — other buildings and
-- the level they must be at before this step can start.
--
-- game_hero_gear: an account's gear is `equipId`; its cost list depends on
-- its quality (game_upgrade_steps hero_gear 'level:q<quality>').

alter table public.game_upgrade_steps
  add column requires jsonb not null default '[]'::jsonb
    check (jsonb_typeof(requires) = 'array');

delete from public.game_upgrade_steps where kind in ('building', 'vehicle_part', 'pet');

create table public.game_hero_gear (
  equip_id int primary key,
  name text,
  name_ko text,
  quality int,
  slot int,
  updated_at timestamptz not null default now()
);

comment on table public.game_hero_gear is
  'Hero gear by equipId: name, quality and slot, from the client''s ds_equip '
  '(0220). Quality picks the level cost list. Written by game-catalog.';

alter table public.game_hero_gear enable row level security;
revoke all on public.game_hero_gear from anon, authenticated;
grant select on public.game_hero_gear to authenticated;
grant all on public.game_hero_gear to service_role;

create policy member_read on public.game_hero_gear
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
