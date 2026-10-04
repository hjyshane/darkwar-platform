-- 0229: what the planner needs to order heroes and to list every material.
--
-- game_hero_rarity: the game's own rarity per hero (aps_new_heroes.rarity),
-- 1 being the top tier the game shows in yellow — Katrina, Francis, Selwyn.
-- heroes.grade is an admin's column and stops at the heroes someone typed in
-- (40007..40015 have none), so the planner orders by this instead: rarity
-- first, then newest (highest id) first. Written by dw-collector game-catalog.
--
-- game_upgrade_materials: every resource and item any upgrade step costs, once
-- each, with the kinds of upgrade that use it. The planner's stock list shows
-- them all — what the account holds of each, editable — without reading 17k
-- steps past PostgREST's 1,000-row cap.

create table public.game_hero_rarity (
  hero_id int primary key,
  rarity smallint not null,
  updated_at timestamptz not null default now()
);

comment on table public.game_hero_rarity is
  'Rarity per hero from the client''s aps_new_heroes (0229): 1 is the top, '
  'yellow tier. Written by game-catalog.';

alter table public.game_hero_rarity enable row level security;
revoke all on public.game_hero_rarity from anon, authenticated;
grant select on public.game_hero_rarity to authenticated;
grant all on public.game_hero_rarity to service_role;

create policy member_read on public.game_hero_rarity
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

create view public.game_upgrade_materials
with (security_invoker = true) as
select
  c ->> 'type' as type,
  c ->> 'id' as id,
  array_agg(distinct s.kind order by s.kind) as kinds
from public.game_upgrade_steps s
cross join lateral jsonb_array_elements(s.costs) as c
group by c ->> 'type', c ->> 'id';

revoke all on public.game_upgrade_materials from anon, authenticated;
grant select on public.game_upgrade_materials to authenticated;
grant select on public.game_upgrade_materials to service_role;
