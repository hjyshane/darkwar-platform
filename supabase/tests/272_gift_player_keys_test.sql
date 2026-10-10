-- 0272: the per-player Gift Center key. Only someone holding giftcodes.manage may
-- save one, the key itself is unreadable from the API (only that it exists is),
-- and a claim for a player without a key is failed with a reason rather than
-- sent or retried.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000f801', 580, 'ext-keys', 'KeyTest', true, 2);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000f801"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000f811', 580, 9570000000000001, 'Keyed', 90, 30),
  ('00000000-0000-4000-8000-00000000f812', 580, 9570000000000002, 'Keyless', 80, 29);

-- ONE captured_at for the whole roster batch (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000f8b1', 'al.rank', 'test',
       'test:272:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000f801', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000f811'::uuid, 9570000000000001::bigint, 'Keyed'),
    ('00000000-0000-4000-8000-00000000f812'::uuid, 9570000000000002::bigint, 'Keyless')
  ) as v(player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f821', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'key-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f822', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'key-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f821', 'member', 'key member'),
  ('00000000-0000-4000-8000-00000000f822', 'officer', 'key officer');
create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.gift_codes (code_id, code, status)
values ('00000000-0000-4000-8000-00000000f831', 'KEYCODE1', 'unverified');

-- -------------------------------------------------------------- who may do it
select ok(
  not has_function_privilege('anon', 'public.set_gift_player_keys(bigint[], uuid[])', 'execute'),
  'anon cannot save a key');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f821');
select throws_ok(
  $$ select public.set_gift_player_keys(array[9570000000000001]::bigint[],
       array['3f2b8c1e-5a47-4d9e-8b6a-0c1d2e3f4a5b']::uuid[]) $$,
  '42501', null, 'a member cannot save a key');

-- ---------------------------------------------------------------- saving one
select pg_temp.act_as('00000000-0000-4000-8000-00000000f822');

select throws_ok(
  $$ select public.set_gift_player_keys(array[9570000000000001, 9570000000000002]::bigint[],
       array['3f2b8c1e-5a47-4d9e-8b6a-0c1d2e3f4a5b']::uuid[]) $$,
  '22023', null, 'IDs and keys must pair up');
select throws_ok(
  $$ select public.set_gift_player_keys(array[12345]::bigint[],
       array['3f2b8c1e-5a47-4d9e-8b6a-0c1d2e3f4a5b']::uuid[]) $$,
  '22023', null, 'a short player ID is refused');

select is(
  public.set_gift_player_keys(array[9570000000000001]::bigint[],
    array['3f2b8c1e-5a47-4d9e-8b6a-0c1d2e3f4a5b']::uuid[]),
  1, 'an officer saves a key');

-- ----------------------------------------------------- the key is not readable
select throws_ok(
  $$ select player_uuid from public.gift_player_keys $$,
  '42501', null, 'the key itself cannot be read from the API');
select is(
  (select count(*)::int from public.gift_player_keys where game_uid = 9570000000000001),
  1, 'but that a player has one can');
select is(
  (select has_key from public.gift_member_status() where game_uid = 9570000000000001),
  true, 'and the member list says so');
select is(
  (select has_key from public.gift_member_status() where game_uid = 9570000000000002),
  false, 'and says which players still need one');

-- ------------------------------------------- claims without a key are failed
reset role;
insert into public.gift_code_claims (code_id, alliance_id, game_uid, status) values
  ('00000000-0000-4000-8000-00000000f831', '00000000-0000-4000-8000-00000000f801', 9570000000000001, 'queued'),
  ('00000000-0000-4000-8000-00000000f831', '00000000-0000-4000-8000-00000000f801', 9570000000000002, 'queued');

select is(internal.gift_fail_keyless(), 1,
  'a queued claim for a player with no key is failed, the keyed one is left');
select is(
  (select last_error from public.gift_code_claims where game_uid = 9570000000000002),
  'no key saved for this player', 'with a plain reason');

-- Saving the key and claiming again queues it afresh.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f822');
select public.set_gift_player_keys(array[9570000000000002]::bigint[],
  array['11111111-2222-4333-8444-555555555555']::uuid[]);
select is(
  public.enqueue_gift_claims(array['00000000-0000-4000-8000-00000000f831']::uuid[],
    array[9570000000000002]::bigint[]),
  1, 'once the key is saved, claiming again queues the failed pair afresh');
reset role;

select * from finish();
rollback;
