-- 0231: real hero levels and the Training Center's heroes ride with account
-- state — the owner reads them, another member does not.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000c1001', 'hero-levels-test');
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000c1201', 580, 9310000000000580, 'owner char'),
  ('00000000-0000-4000-8000-0000000c1202', 580, 9310000000001580, 'other char');
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000c1101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c1-owner@test.invalid'),
  ('00000000-0000-4000-8000-0000000c1102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c1-other@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000000c1101', 'member', 'owner', '00000000-0000-4000-8000-0000000c1201'),
  ('00000000-0000-4000-8000-0000000c1102', 'member', 'other', '00000000-0000-4000-8000-0000000c1202')
on conflict (user_id) do update set role = excluded.role, player_id = excluded.player_id;
insert into public.user_players (player_id, user_id) values
  ('00000000-0000-4000-8000-0000000c1201', '00000000-0000-4000-8000-0000000c1101'),
  ('00000000-0000-4000-8000-0000000c1202', '00000000-0000-4000-8000-0000000c1102')
on conflict do nothing;

insert into public.account_state_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid,
   hero_levels, hero_trained)
values
  (gen_random_uuid(), 'init', '1.4.0', 'c1-test:1', '2026-10-04 20:00+00',
   '00000000-0000-4000-8000-0000000c1001', 580, 580,
   '00000000-0000-4000-8000-0000000c1201', 9310000000000580,
   '{"40006": 130, "1016": 40}', '["40006"]');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000c1101')::text, true);
select is((select (hero_levels ->> '40006')::int from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000c1201'), 130,
  'the owner reads hero levels');
select is((select hero_trained from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000c1201'), '["40006"]'::jsonb,
  'and which heroes the Training Center holds');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000c1102')::text, true);
select is((select count(*)::int from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000c1201'), 0,
  'another member reads neither');
reset role;

select * from finish();
rollback;
