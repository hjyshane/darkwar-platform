-- 0222: research tabs are member-readable and nobody else's to write;
-- exclusive weapon steps are a kind; an account's exclusive weapon levels
-- ride with its state, owner-or-admin only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ce001', 'planner-tabs-test');
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000ce201', 580, 9280000000000580, 'owner char'),
  ('00000000-0000-4000-8000-0000000ce202', 580, 9280000000001580, 'other char');
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ce101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ce-owner@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ce-other@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000000ce101', 'member', 'owner', '00000000-0000-4000-8000-0000000ce201'),
  ('00000000-0000-4000-8000-0000000ce102', 'member', 'other', '00000000-0000-4000-8000-0000000ce202')
on conflict (user_id) do update set role = excluded.role, player_id = excluded.player_id;
insert into public.user_players (player_id, user_id) values
  ('00000000-0000-4000-8000-0000000ce201', '00000000-0000-4000-8000-0000000ce101'),
  ('00000000-0000-4000-8000-0000000ce202', '00000000-0000-4000-8000-0000000ce102')
on conflict do nothing;

insert into public.account_state_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid, hero_exclusives)
values
  (gen_random_uuid(), 'init', '1.3.0', 'ce-test:1', '2026-10-04 03:00+00',
   '00000000-0000-4000-8000-0000000ce001', 580, 580,
   '00000000-0000-4000-8000-0000000ce201', 9280000000000580, '{"40002": 42}');
insert into public.game_upgrade_steps (kind, subject_id, level, name, costs, tier) values
  ('building', '999000', 2, 'Campfire', '[]', null),
  ('building', '999000', 30, 'Watchtower', '[]', null),
  ('building', '999000', 35, 'Industrial Watchtower', '[]', 1);
insert into public.game_research_tabs (tab_id, name, sort_order, servers)
values (1007, 'Battle', 7, '[[565, 9999]]');

-- 1. Exclusive weapons are a step kind, with tier and category free.
select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs, tier, category)
     values ('exclusive', '40002', 1, '[{"type": "item", "id": "253070", "amount": 10}]', null, null) $$,
  'an exclusive weapon step is accepted');

set local role authenticated;

-- 2. The owner reads their exclusive weapon levels.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ce101')::text, true);
select is((select (hero_exclusives ->> '40002')::int from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000ce201'), 42,
  'the owner reads their exclusive weapon levels');
-- 3. A member reads tab names.
select is((select name from public.game_research_tabs where tab_id = 1007), 'Battle',
  'a member reads research tab names');
-- 3b. Subjects summarise their steps: highest level and first name.
select is((select max_level from public.game_upgrade_subjects
            where kind = 'exclusive' and subject_id = '40002'), 1,
  'a member reads the subject summary');
-- 3c. A building is named by its highest level outside a tier.
select is((select name from public.game_upgrade_subjects
            where kind = 'building' and subject_id = '999000'), 'Watchtower',
  'a tiered building takes its last untiered name');
-- 4. But cannot write them.
select throws_ok(
  $$ insert into public.game_research_tabs (tab_id, name) values (1, 'x') $$,
  '42501', null, 'a member cannot write research tabs');

-- 5. Another member does not see the owner's exclusive weapons.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ce102')::text, true);
select is((select count(*)::int from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000ce201'), 0,
  'another member does not read the owner''s exclusive weapons');
reset role;

-- 6. Anon reads no tabs.
select ok(not has_table_privilege('anon', 'public.game_research_tabs', 'select'),
  'anon has no read on research tabs');
-- 6b. Nor the subject summary.
select ok(not has_table_privilege('anon', 'public.game_upgrade_subjects', 'select'),
  'anon has no read on the subject summary');
-- 7. Authenticated holds select only (hosted default grants give ALL).
select ok(not has_table_privilege('authenticated', 'public.game_research_tabs', 'truncate'),
  'authenticated cannot truncate research tabs');

select * from finish();
rollback;
