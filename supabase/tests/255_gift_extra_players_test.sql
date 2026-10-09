-- 0254: player IDs saved beyond the roster. Only someone holding giftcodes.manage
-- may save or remove one, an ID is checked for shape, "claim for everyone" now
-- includes the saved list, exclusions hold for it, and the member list and the
-- per-code counts see it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000f701', 580, 'ext-extra', 'ExtraTest', true, 2);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000f701"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000f711', 580, 9550000000000001, 'Roster One', 90, 30),
  ('00000000-0000-4000-8000-00000000f712', 580, 9550000000000002, 'Roster Two', 80, 29);

-- ONE captured_at for the whole roster batch (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000f7b1', 'al.rank', 'test',
       'test:255:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000f701', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000f711'::uuid, 9550000000000001::bigint, 'Roster One'),
    ('00000000-0000-4000-8000-00000000f712'::uuid, 9550000000000002::bigint, 'Roster Two')
  ) as v(player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f721', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'extra-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f722', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'extra-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f721', 'member', 'extra member'),
  ('00000000-0000-4000-8000-00000000f722', 'officer', 'extra officer');
create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.gift_codes (code_id, code, status)
values ('00000000-0000-4000-8000-00000000f731', 'EXTRACODE1', 'working');

-- -------------------------------------------------------------- who may do it
select ok(
  not has_function_privilege('anon', 'public.add_gift_extra_players(bigint[], text)', 'execute')
  and not has_function_privilege('anon', 'public.remove_gift_extra_player(bigint)', 'execute'),
  'anon can neither save nor remove a player ID');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f721');
select throws_ok(
  $$ select public.add_gift_extra_players(array[9560000000000001]::bigint[]) $$,
  '42501', null, 'a member cannot save a player ID');
select throws_ok(
  $$ select public.remove_gift_extra_player(9560000000000001) $$,
  '42501', null, 'a member cannot remove one');
select is_empty($$ select * from public.gift_extra_players $$,
  'and a member reads no saved IDs');

-- -------------------------------------------------------------------- saving
select pg_temp.act_as('00000000-0000-4000-8000-00000000f722');

select throws_ok(
  $$ select public.add_gift_extra_players(array[12345]::bigint[]) $$,
  '22023', null, 'an ID that is too short is refused');
select throws_ok(
  $$ select public.add_gift_extra_players(array[]::bigint[]) $$,
  '22023', null, 'so is an empty list');

select is(
  public.add_gift_extra_players(
    array[9560000000000001, 9560000000000002, 9560000000000002, 9550000000000001]::bigint[]),
  2,
  'duplicates in the list, and a player already on the roster, are skipped');
select is(
  public.add_gift_extra_players(array[9560000000000001]::bigint[]), 0,
  'saving one that is already saved adds nothing');

select is(
  public.add_gift_extra_players(array[9560000000000003]::bigint[], 'Cousin'), 1,
  'a single ID can carry a label');

-- ------------------------------------------------------- what the screen sees
select is(
  (select count(*)::int from public.gift_member_status() where extra),
  3, 'the member list shows the saved IDs after the roster');
select is(
  (select name from public.gift_member_status() where game_uid = 9560000000000003),
  'Cousin', 'a label is the name');
select is(
  (select name from public.gift_member_status() where game_uid = 9560000000000001),
  'UID 9560000000000001', 'without a label the name is the ID');
select is(
  (select members from public.gift_code_progress()
    where code_id = '00000000-0000-4000-8000-00000000f731'),
  5, 'the code''s "members" counts roster and saved IDs');

-- ------------------------------------------------------------------ queueing
select is(
  public.enqueue_gift_claims(array['00000000-0000-4000-8000-00000000f731']::uuid[]),
  5, 'claiming for everyone queues the roster and the saved list');

select public.set_gift_exclusion(9560000000000002, true);
select is(
  (select status from public.gift_code_claims where game_uid = 9560000000000002),
  'cancelled', 'leaving a saved ID out cancels its waiting claim, as for the roster');

-- ------------------------------------------------------------------ removing
select public.remove_gift_extra_player(9560000000000001);
select is(
  (select status from public.gift_code_claims where game_uid = 9560000000000001),
  'cancelled', 'removing a saved ID cancels what was waiting for it');
select is(
  (select count(*)::int from public.gift_extra_players where game_uid = 9560000000000001),
  0, 'and takes it off the list');

reset role;
select * from finish();
rollback;
