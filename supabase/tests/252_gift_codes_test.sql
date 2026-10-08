-- 0251: gift codes. Only someone holding giftcodes.manage reads or writes any of
-- it, a code is checked for its shape, claims are queued for the whole roster or
-- the players named, exclusions hold, and what is done is not queued again.
--
-- The refusals come first (§20.2): this queues requests that go out under the
-- members' own player ids.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-00000000f501', 580, 'ext-gift', 'GiftTest', true, 3),
  ('00000000-0000-4000-8000-00000000f502', 580, 'ext-gift2', 'OtherGift', false, 0);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000f501"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000f101', 580, 9520000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000f102', 580, 9520000000000102, 'Bravo', 80, 29),
  ('00000000-0000-4000-8000-00000000f103', 580, 9520000000000103, 'Charlie', 70, 28);

-- ONE captured_at for the whole roster batch: alliance_roster_latest returns the
-- rows sharing the newest instant, so members written a moment apart are a
-- roster of one (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000f0b1', 'al.rank', 'test',
       'test:252:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000f501', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000f101'::uuid, 9520000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000f102'::uuid, 9520000000000102::bigint, 'Bravo'),
    ('00000000-0000-4000-8000-00000000f103'::uuid, 9520000000000103::bigint, 'Charlie')
  ) as v(player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gift-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gift-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f301', 'member', 'gift member'),
  ('00000000-0000-4000-8000-00000000f302', 'officer', 'gift officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- A code and a claim written the way the worker's service role would, so the
-- member's refusals have something to be refused.
insert into public.gift_codes (code_id, code, status)
values ('00000000-0000-4000-8000-00000000f901', 'SEEDCODE1', 'working');

-- ------------------------------------------------------------ who may do it

select is(has_function_privilege('anon', 'public.add_gift_code(text)', 'execute'), false,
  'anon cannot add a code');
select is(has_function_privilege('anon', 'public.enqueue_gift_claims(uuid[], bigint[])', 'execute'),
  false, 'anon cannot queue a claim');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f301');

select throws_ok($$ select public.add_gift_code('ABCDEF') $$, '42501', null,
  'a member cannot add a code');
select throws_ok(
  $$ select public.enqueue_gift_claims(array['00000000-0000-4000-8000-00000000f901']::uuid[]) $$,
  '42501', null, 'a member cannot queue claims');
select throws_ok($$ select public.set_gift_exclusion(9520000000000101, true) $$, '42501', null,
  'a member cannot exclude anyone');
select is_empty($$ select * from public.gift_codes $$, 'a member reads no codes');
select throws_ok(
  $$ insert into public.gift_codes (code) values ('DIRECT1') $$, '42501', null,
  'nobody signed in can write the table directly');

-- ------------------------------------------------------------ an officer

select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');

select is((select count(*)::int from public.gift_codes), 1, 'an officer reads the codes');

create temp table t_added as select public.add_gift_code(' MAPLE3 ') as id;
select is((select code from public.gift_codes where code_id = (select id from t_added)),
  'MAPLE3', 'a code is stored trimmed and keeps its case');
select is(public.add_gift_code('MAPLE3'), (select id from t_added),
  'adding the same code again returns the one already there');
select throws_ok($$ select public.add_gift_code('has space') $$, '22023', null,
  'a code with a space is refused');
select throws_ok($$ select public.add_gift_code(repeat('A', 33)) $$, '22023', null,
  'a code longer than 32 characters is refused');

-- Queue the new code for the whole roster.
select is(public.enqueue_gift_claims(array[(select id from t_added)]), 3,
  'queued for all three roster members');
select is(public.enqueue_gift_claims(array[(select id from t_added)]), 0,
  'queueing again adds nothing: they are already waiting');

-- Exclude Bravo: the waiting claim is cancelled and stays out.
select public.set_gift_exclusion(9520000000000102, true);
select is((select status from public.gift_code_claims
            where code_id = (select id from t_added) and game_uid = 9520000000000102),
  'cancelled', 'excluding someone cancels what was waiting for them');
select is(public.enqueue_gift_claims(array[(select id from t_added)]), 0,
  'an excluded player is not queued again');
select is(public.enqueue_gift_claims(array[(select id from t_added)],
                                     array[9520000000000102]::bigint[]), 0,
  'not even when named by hand');

-- Un-exclude: the cancelled pair is queued afresh.
select public.set_gift_exclusion(9520000000000102, false);
select is(public.enqueue_gift_claims(array[(select id from t_added)]), 1,
  'a cancelled pair is queued again once the player is back in');

-- Done is left alone.
reset role;
update public.gift_code_claims set status = 'done'
 where code_id = (select id from t_added) and game_uid = 9520000000000101;
update public.gift_code_claims set status = 'failed'
 where code_id = (select id from t_added) and game_uid = 9520000000000103;
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');

select is(public.enqueue_gift_claims(array[(select id from t_added)]), 1,
  'a failed pair is retried, a done one is not');
select is((select status from public.gift_code_claims
            where code_id = (select id from t_added) and game_uid = 9520000000000101),
  'done', 'and what was done stays done');

-- The two reads the screen uses.
select is((select members from public.gift_code_progress() where code = 'MAPLE3'), 3,
  'progress counts the roster members');
select is((select done from public.gift_code_progress() where code = 'MAPLE3'), 1,
  'and what is done');
select is((select count(*)::int from public.gift_member_status()), 3,
  'member status has one row per person');
select is((select claims ->> (select id::text from t_added)
             from public.gift_member_status() where game_uid = 9520000000000101),
  'done', 'with each code''s status for them');

-- An expired code cannot be queued.
select public.set_gift_code_status((select id from t_added), 'expired');
select is(public.enqueue_gift_claims(array[(select id from t_added)]), 0,
  'an expired code is not queued');

-- Another alliance's claims are not this alliance's to see.
reset role;
insert into public.gift_code_claims (code_id, alliance_id, game_uid)
values ((select id from t_added), '00000000-0000-4000-8000-00000000f502', 9529999999999999);
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');
select is((select count(*)::int from public.gift_code_claims where game_uid = 9529999999999999), 0,
  'a claim of another alliance is not visible');
reset role;

select * from finish();
rollback;
