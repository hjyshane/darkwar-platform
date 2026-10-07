-- 0239: a score bar for the daily boards, and the days that cleared it.
--
-- Fixed dates, all inside the game week opening Monday 2026-09-14 02:00 UTC.
-- The refusals come first (§20.2): a bar written by somebody who may not, or
-- read across alliances, would judge members by a number nobody here set.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-00000000e901', 580, 'ext-thr', 'BarTest', true, 2),
  ('00000000-0000-4000-8000-00000000e902', 580, 'ext-thr2', 'OtherBar', false, 0);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000e901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000e101', 580, 9390000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000e102', 580, 9390000000000102, 'Bravo', 80, 29);

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000e0b1', 'al.rank', 'test',
       'test:136:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000e901', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000e101'::uuid, 9390000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000e102'::uuid, 9390000000000102::bigint, 'Bravo')
  ) as v(player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000e301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'thr-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000e302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'thr-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000e303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'thr-admin@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e301', 'viewer', 'thr viewer'),
  ('00000000-0000-4000-8000-00000000e302', 'member', 'thr member'),
  ('00000000-0000-4000-8000-00000000e303', 'admin', 'thr admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

create function pg_temp.reading(key text, uid bigint, kind text, at timestamptz, score bigint)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, contribution_type, score)
  values ('00000000-0000-4000-8000-00000000e0b2', 'test.board', 'test', 'test:136:' || key,
          at, '00000000-0000-4000-8000-000000000c01', 580, 580, uid, kind, score);
$$;

-- Duel, daily. 09-14: Alpha 100 then 150 later that day, Bravo 50.
-- 09-15: Alpha 0, Bravo unread. 09-16: Alpha 300, Bravo 120.
select pg_temp.reading('d1', 9390000000000101, 'alliance_battle_daily', '2026-09-14T10:00:00Z', 100);
select pg_temp.reading('d2', 9390000000000101, 'alliance_battle_daily', '2026-09-14T20:00:00Z', 150);
select pg_temp.reading('d3', 9390000000000102, 'alliance_battle_daily', '2026-09-14T10:00:00Z', 50);
select pg_temp.reading('d4', 9390000000000101, 'alliance_battle_daily', '2026-09-15T10:00:00Z', 0);
select pg_temp.reading('d5', 9390000000000101, 'alliance_battle_daily', '2026-09-16T10:00:00Z', 300);
select pg_temp.reading('d6', 9390000000000102, 'alliance_battle_daily', '2026-09-16T10:00:00Z', 120);
-- Donations, daily, 09-14: Alpha 40, Bravo 500.
select pg_temp.reading('n1', 9390000000000101, 'daily_donation', '2026-09-14T10:00:00Z', 40);
select pg_temp.reading('n2', 9390000000000102, 'daily_donation', '2026-09-14T10:00:00Z', 500);

-- Another alliance's bar, written as the owner, that nobody here may see.
insert into public.participation_thresholds (alliance_id, board, daily_min)
values ('00000000-0000-4000-8000-00000000e902', 'duel', 999999);

-- ------------------------------------------------------------- refusals

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e302');
set local role authenticated;
select throws_ok(
  $$select public.set_participation_threshold('duel', 100)$$,
  '42501',
  null,
  'a member cannot set a bar');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e301');
set local role authenticated;
select throws_ok(
  $$select public.set_participation_threshold('duel', 100)$$,
  '42501',
  null,
  'a viewer cannot set a bar');
select is((select count(*) from public.participation_thresholds), 0::bigint,
  'a viewer reads no bars');

reset role;
select ok(not has_function_privilege('anon',
  'public.set_participation_threshold(text, bigint)', 'execute'),
  'anon cannot set a bar');
select ok(not has_function_privilege('anon',
  'public.member_participation(timestamptz, timestamptz, bigint, bigint)', 'execute'),
  'anon cannot run the report');

-- ------------------------------------------------------------- the writer

select pg_temp.act_as('00000000-0000-4000-8000-00000000e303');
set local role authenticated;
select lives_ok(
  $$select public.set_participation_threshold('duel', 100)$$,
  'an admin sets the duel bar');
select throws_ok(
  $$select public.set_participation_threshold('chat', 100)$$,
  '22023', null, 'an unknown board is refused');
select throws_ok(
  $$select public.set_participation_threshold('duel', -5)$$,
  '22023', null, 'a negative bar is refused');
select is((select daily_min from public.participation_thresholds where board = 'duel'), 100::bigint,
  'the bar is stored, and only this alliance''s is visible');
select is((select count(*) from public.participation_thresholds), 1::bigint,
  'the other alliance''s bar stays out of sight');

-- ------------------------------------------------------------ the report

create temp table r on commit drop as
  select current_name, duel_days_over, donation_days_over
    from public.member_participation('2026-09-14T02:00:00Z', '2026-09-21T02:00:00Z', 100, 400);

select is((select duel_days_over from r where current_name = 'Alpha'), 2,
  'Alpha cleared 100 on 09-14 (150) and 09-16 (300), not on 09-15 (0)');
select is((select duel_days_over from r where current_name = 'Bravo'), 1,
  'Bravo cleared it once: 50 does not, 120 does, an unread day is not a miss');
select is(
  (select array[donation_days_over] from r where current_name = 'Bravo'), array[1],
  'Bravo''s 500 donation clears 400');

create temp table r2 on commit drop as
  select current_name, duel_days_over, donation_days_over
    from public.member_participation('2026-09-14T02:00:00Z', '2026-09-21T02:00:00Z');
select ok((select bool_and(duel_days_over is null and donation_days_over is null) from r2),
  'with no bar the columns are null, not zero');

select lives_ok(
  $$select public.set_participation_threshold('duel', null)$$,
  'a null bar clears it');

select * from finish();
rollback;
