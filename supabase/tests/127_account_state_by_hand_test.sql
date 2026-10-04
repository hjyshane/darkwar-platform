-- 0223: hand-entered planner state. The owner reads and writes their own
-- character; data.enter (an officer) writes anyone's; another member can
-- neither read nor write it; anon has nothing; nobody truncates.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000d0201', 580, 9290000000000580, 'owner char'),
  ('00000000-0000-4000-8000-0000000d0202', 580, 9290000000001580, 'other char');
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000d0101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd0-owner@test.invalid'),
  ('00000000-0000-4000-8000-0000000d0102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd0-other@test.invalid'),
  ('00000000-0000-4000-8000-0000000d0103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd0-officer@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000000d0101', 'member', 'owner', '00000000-0000-4000-8000-0000000d0201'),
  ('00000000-0000-4000-8000-0000000d0102', 'member', 'other', '00000000-0000-4000-8000-0000000d0202'),
  ('00000000-0000-4000-8000-0000000d0103', 'officer', 'officer', null)
on conflict (user_id) do update set role = excluded.role, player_id = excluded.player_id;
insert into public.user_players (player_id, user_id) values
  ('00000000-0000-4000-8000-0000000d0201', '00000000-0000-4000-8000-0000000d0101'),
  ('00000000-0000-4000-8000-0000000d0202', '00000000-0000-4000-8000-0000000d0102')
on conflict do nothing;

set local role authenticated;

-- 1-2. The owner writes their own character and reads it back, stamped.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000d0101')::text, true);
select lives_ok(
  $$ insert into public.account_state_manual (player_id, buildings, effects)
     values ('00000000-0000-4000-8000-0000000d0201', '{"400000": 30}', '{"30070": 80}') $$,
  'the owner enters their own levels');
select is((select (buildings ->> '400000')::int from public.account_state_manual
            where player_id = '00000000-0000-4000-8000-0000000d0201'), 30,
  'and reads them back');
select is((select updated_by from public.account_state_manual
            where player_id = '00000000-0000-4000-8000-0000000d0201'),
  '00000000-0000-4000-8000-0000000d0101'::uuid,
  'stamped with who entered it');

-- 4. The owner cannot write another member's character.
select throws_ok(
  $$ insert into public.account_state_manual (player_id)
     values ('00000000-0000-4000-8000-0000000d0202') $$,
  '42501', null, 'the owner cannot enter another member''s levels');

-- 5-6. Another member neither reads nor changes the owner's row.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000d0102')::text, true);
select is((select count(*)::int from public.account_state_manual
            where player_id = '00000000-0000-4000-8000-0000000d0201'), 0,
  'another member does not read it');
update public.account_state_manual set buildings = '{}'
  where player_id = '00000000-0000-4000-8000-0000000d0201';
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000d0101')::text, true);
select is((select (buildings ->> '400000')::int from public.account_state_manual
            where player_id = '00000000-0000-4000-8000-0000000d0201'), 30,
  'nor changes it');

-- 7. An officer (data.enter) enters a member's levels for them.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000d0103')::text, true);
select lives_ok(
  $$ insert into public.account_state_manual (player_id, science)
     values ('00000000-0000-4000-8000-0000000d0202', '{"1601100": 5}') $$,
  'an officer enters a member''s levels');

-- 8. Shapes are checked.
select throws_ok(
  $$ update public.account_state_manual set hero_equips = '{}'
     where player_id = '00000000-0000-4000-8000-0000000d0202' $$,
  '23514', null, 'gear must be a list');
reset role;

-- 9-10. Anon has nothing; authenticated cannot truncate.
select ok(not has_table_privilege('anon', 'public.account_state_manual', 'select'),
  'anon has no read');
select ok(not has_table_privilege('authenticated', 'public.account_state_manual', 'truncate'),
  'authenticated cannot truncate');

select * from finish();
rollback;
