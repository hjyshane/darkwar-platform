-- 0219: an account's buffs ride with its state — the owner and admins read
-- them, another member does not — and effect names are member-readable.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000bf001', 'account-buffs-test');
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000bf201', 580, 9270000000000580, 'owner char'),
  ('00000000-0000-4000-8000-0000000bf202', 580, 9270000000001580, 'other char');
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000bf101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bf-owner@test.invalid'),
  ('00000000-0000-4000-8000-0000000bf102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bf-other@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000000bf101', 'member', 'owner', '00000000-0000-4000-8000-0000000bf201'),
  ('00000000-0000-4000-8000-0000000bf102', 'member', 'other', '00000000-0000-4000-8000-0000000bf202')
on conflict (user_id) do update set role = excluded.role, player_id = excluded.player_id;
insert into public.user_players (player_id, user_id) values
  ('00000000-0000-4000-8000-0000000bf201', '00000000-0000-4000-8000-0000000bf101'),
  ('00000000-0000-4000-8000-0000000bf202', '00000000-0000-4000-8000-0000000bf102')
on conflict do nothing;

insert into public.account_state_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid,
   effects, timed_effects)
values
  (gen_random_uuid(), 'init', '1.1.0', 'bf-test:1', '2026-10-03 23:00+00',
   '00000000-0000-4000-8000-0000000bf001', 580, 580,
   '00000000-0000-4000-8000-0000000bf201', 9270000000000580,
   '{"30070": 73.14, "30421": 14.5}',
   '[{"effect": 30070, "value": 50, "start": 1790992800000, "end": 1791079200000}]');
insert into public.game_effects (effect_id, name) values (30070, 'Construction Speed');

set local role authenticated;

-- 1-2. The owner reads the buffs and the timed buffs through the latest view.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000bf101')::text, true);
select is((select (effects ->> '30070')::numeric from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000bf201'), 73.14,
  'the owner reads their construction speed');
select is((select jsonb_array_length(timed_effects) from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000bf201'), 1,
  'and their timed buffs');
-- 3. Effect names are readable by members.
select is((select name from public.game_effects where effect_id = 30070), 'Construction Speed',
  'a member reads effect names');

-- 4. Another member does not see the owner's buffs.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000bf102')::text, true);
select is((select count(*)::int from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000bf201'), 0,
  'another member does not read the owner''s buffs');
-- 5. Nor write effect names.
select throws_ok(
  $$ insert into public.game_effects (effect_id, name) values (1, 'x') $$,
  '42501', null, 'a member cannot write effect names');
reset role;

-- 6. Anon reads no effect names.
select ok(not has_table_privilege('anon', 'public.game_effects', 'select'),
  'anon has no read on effect names');

select * from finish();
rollback;
