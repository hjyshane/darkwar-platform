-- 0222: what the planner needs to show things the way the game does.
--
-- game_upgrade_steps.tier: a building's industry tier at the level reached,
-- from the client's building.industry_level. Only Watchtower has one: 35-39
-- is "Industry Lv.1", 40-44 Lv.2 ... 75-79 Lv.9, 80 Lv.10. The planner shows
-- those levels as i1..i10.
--
-- game_upgrade_steps.category: a research step's tab on the research screen
-- (aps_science.tab), named and ordered by game_research_tabs. Servers 1-564
-- and 565+ have different trees; `servers` says which ranges see a tab, and
-- an empty list means every server.
--
-- Kind 'exclusive': exclusive weapons (heroes_exclusive_equip), subject the
-- hero id, levels 1-52, paid in that weapon's fragments.
--
-- account_state_snapshots.hero_exclusives: the account's exclusive weapon
-- levels by hero id, from the login's heroEquipUniques (account_state 1.3.0).

alter table public.game_upgrade_steps
  add column tier smallint,
  add column category int;

alter table public.game_upgrade_steps drop constraint game_upgrade_steps_kind_check;
alter table public.game_upgrade_steps
  add constraint game_upgrade_steps_kind_check
  check (kind in ('building', 'research', 'vehicle_part', 'pet', 'hero', 'hero_gear', 'exclusive'));

create table public.game_research_tabs (
  tab_id int primary key,
  name text,
  name_ko text,
  sort_order int,
  servers jsonb not null default '[]'::jsonb check (jsonb_typeof(servers) = 'array'),
  updated_at timestamptz not null default now()
);

comment on table public.game_research_tabs is
  'The research screen''s tabs, from the client''s aps_science_tab (0222): '
  'name, order and the server ranges that see each ([] = all). Written by '
  'dw-collector game-catalog.';

alter table public.game_research_tabs enable row level security;
revoke all on public.game_research_tabs from anon, authenticated;
grant select on public.game_research_tabs to authenticated;
grant all on public.game_research_tabs to service_role;

create policy member_read on public.game_research_tabs
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

alter table public.account_state_snapshots
  add column hero_exclusives jsonb not null default '{}'::jsonb;

-- Recreated with the new column at the end (0221's body plus
-- hero_exclusives); the snapshot table's policy and grants still apply
-- through security invoker.
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
  s.hero_exclusives
from public.account_state_snapshots s
where s.player_id is not null
order by s.player_id, s.captured_at desc;

-- One row per upgradeable thing: its name, highest level and tab, so the
-- planner's pickers list subjects without pulling every step (17k rows, far
-- past PostgREST's 1,000). The name is the first step's: "Watchtower", not
-- the "Industrial Watchtower" its later levels are called.
create view public.game_upgrade_subjects
with (security_invoker = true) as
select
  s.kind,
  s.subject_id,
  max(s.level) as max_level,
  min(s.category) as category,
  (array_agg(s.name order by s.level) filter (where s.name is not null))[1] as name,
  (array_agg(s.name_ko order by s.level) filter (where s.name_ko is not null))[1] as name_ko
from public.game_upgrade_steps s
group by s.kind, s.subject_id;

revoke all on public.game_upgrade_subjects from anon, authenticated;
grant select on public.game_upgrade_subjects to authenticated;
grant select on public.game_upgrade_subjects to service_role;
