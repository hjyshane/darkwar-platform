-- 0273: a member saves the Gift Center key of THEIR OWN character and nobody
-- else's, can see that one is saved but never read it back, and can take it away.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000f901', 580, 'ext-mykey', 'MyKeyTest', true, 2);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000f901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000f911', 580, 9580000000000001, 'Mine', 90, 30),
  ('00000000-0000-4000-8000-00000000f912', 580, 9580000000000002, 'Theirs', 80, 29);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f921', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mykey-me@test.invalid'),
  ('00000000-0000-4000-8000-00000000f922', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mykey-other@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f921', 'member', 'me'),
  ('00000000-0000-4000-8000-00000000f922', 'member', 'other');
-- app_users.player_id is mirrored into user_players by trigger (0193); say it
-- outright for the fixture so the test does not depend on that.
insert into public.user_players (player_id, user_id) values
  ('00000000-0000-4000-8000-00000000f911', '00000000-0000-4000-8000-00000000f921'),
  ('00000000-0000-4000-8000-00000000f912', '00000000-0000-4000-8000-00000000f922')
on conflict (player_id) do nothing;

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.gift_codes (code_id, code, status)
values ('00000000-0000-4000-8000-00000000f931', 'MYKEYCODE', 'unverified');

-- ----------------------------------------------------------------- reachable
select ok(
  not has_function_privilege('anon', 'public.save_my_gift_key(bigint, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_gift_keys()', 'execute')
  and not has_function_privilege('anon', 'public.remove_my_gift_key(bigint)', 'execute'),
  'anon can reach none of it');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f921');

select is(
  (select count(*)::int from public.my_gift_keys()), 1,
  'a member lists their own character, not the other one');
select is(
  (select has_key from public.my_gift_keys() where game_uid = 9580000000000001),
  false, 'with no key saved yet');

-- --------------------------------------------------------------------- saving
select lives_ok(
  $$ select public.save_my_gift_key(9580000000000001, '3f2b8c1e-5a47-4d9e-8b6a-0c1d2e3f4a5b') $$,
  'a member saves the key of their own character');
select is(
  (select has_key from public.my_gift_keys() where game_uid = 9580000000000001),
  true, 'and then sees that one is saved');
select throws_ok(
  $$ select public.save_my_gift_key(9580000000000002, '3f2b8c1e-5a47-4d9e-8b6a-0c1d2e3f4a5b') $$,
  '42501', null, 'but not for a character that is someone else''s');
select throws_ok(
  $$ select public.save_my_gift_key(9580000000000001, null) $$,
  '22023', null, 'and a key is required');
select throws_ok(
  $$ select player_uuid from public.gift_player_keys $$,
  '42501', null, 'the key itself is never readable');

-- --------------------------------------------------------------------- others
select pg_temp.act_as('00000000-0000-4000-8000-00000000f922');
select is(
  (select has_key from public.my_gift_keys() where game_uid = 9580000000000002),
  false, 'another member does not see my key as theirs');
select throws_ok(
  $$ select public.remove_my_gift_key(9580000000000001) $$,
  '42501', null, 'and cannot remove it');

-- ------------------------------------------------------------------ removing
reset role;
insert into public.gift_code_claims (code_id, alliance_id, game_uid, status)
values ('00000000-0000-4000-8000-00000000f931', '00000000-0000-4000-8000-00000000f901',
        9580000000000001, 'queued');
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f921');
select public.remove_my_gift_key(9580000000000001);
select is(
  (select has_key from public.my_gift_keys() where game_uid = 9580000000000001),
  false, 'removing it takes it away');
reset role;
select is(
  (select status from public.gift_code_claims where game_uid = 9580000000000001),
  'cancelled', 'and what was waiting to be sent with it is cancelled');

select * from finish();
rollback;
