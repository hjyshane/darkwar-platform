-- 0183: misses are counted per person, only from reported battles, only
-- from the 2026-09-27 event onward.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create function pg_temp.battle(key text, ended timestamptz, team int)
returns void language sql as $$
  insert into public.black_money_battle_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, alliance_external_id,
     battle_ended_at, team_index, state, score, user_num, max_user_num)
  values ('00000000-0000-4000-8000-00000000f981', 'dragon.activity.info', 'test', key,
          ended + interval '1 hour', '00000000-0000-4000-8000-000000000c01', 580, 580,
          'b1550000000000000000000000000001', ended, team, 2, 1, 20, 20);
$$;

create function pg_temp.signup(key text, at timestamptz, uid bigint, team int, state int)
returns void language sql as $$
  insert into public.black_money_signup_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, name, state, team_index)
  values ('00000000-0000-4000-8000-00000000f982', 'dragon.assign.player.info', 'test', key,
          at, '00000000-0000-4000-8000-000000000c01', 580, 580, uid, 'P' || uid, state, team);
$$;

create function pg_temp.score(key text, sent timestamptz, uid bigint)
returns void language sql as $$
  insert into public.black_money_score_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, name,
     alliance_external_id, side, win, reported_at, score)
  values ('00000000-0000-4000-8000-00000000f983', 'push.mail', 'test', key,
          sent + interval '1 minute', '00000000-0000-4000-8000-000000000c01', 580, 580,
          uid, 'P' || uid, 'b1550000000000000000000000000001', 0, 1, sent, 100);
$$;

-- 09-27: team B at 12:50 with a report, team A at 21:50 with a report.
select pg_temp.battle('t:bgm:b', '2026-09-27T12:50:00Z', 2);
select pg_temp.battle('t:bgm:a', '2026-09-27T21:50:00Z', 1);
-- 10-11: team A at 21:50 with NO report yet.
select pg_temp.battle('t:bgm:a2', '2026-10-11T21:50:00Z', 1);
-- 09-13, before the tally starts: a report, and a miss that must not count.
select pg_temp.battle('t:bgm:old', '2026-09-13T21:50:00Z', 1);

-- 901: starter on B, missed. Starter on A, played. Starter on 10-11, no report.
-- 902: substitute on B, missed; substitute on A, missed.
-- 903: missed on 09-13 only.
select pg_temp.signup('t:bgm:s1', '2026-09-27T09:00:00Z', 9901000000000580, 2, 1);
select pg_temp.signup('t:bgm:s2', '2026-09-27T09:00:00Z', 9902000000000580, 2, 2);
select pg_temp.signup('t:bgm:s3', '2026-09-27T15:00:00Z', 9901000000000580, 1, 1);
select pg_temp.signup('t:bgm:s4', '2026-09-27T15:00:00Z', 9902000000000580, 1, 2);
select pg_temp.signup('t:bgm:s5', '2026-10-11T15:00:00Z', 9901000000000580, 1, 1);
select pg_temp.signup('t:bgm:s6', '2026-09-13T15:00:00Z', 9903000000000580, 1, 1);

-- Reports: someone else played B; 901 played A; someone else played 09-13.
select pg_temp.score('t:bgm:p1', '2026-09-27T12:54:00Z', 9999000000000580);
select pg_temp.score('t:bgm:p2', '2026-09-27T21:54:00Z', 9901000000000580);
select pg_temp.score('t:bgm:p3', '2026-09-13T21:54:00Z', 9999000000000580);

select is((select starter_misses::int from public.black_money_member_misses
            where game_uid = 9901000000000580), 1,
  'a starter who missed one battle and played another has one miss');

select is((select starter_battles::int from public.black_money_member_misses
            where game_uid = 9901000000000580), 2,
  'out of the two reported battles they were listed for');

select is((select substitute_misses::int from public.black_money_member_misses
            where game_uid = 9902000000000580), 2,
  'a substitute absent from both reports has two substitute misses');

select is((select starter_misses::int from public.black_money_member_misses
            where game_uid = 9902000000000580), 0,
  'and no starter misses');

select is((select count(*)::int from public.black_money_member_misses
            where game_uid = 9903000000000580), 0,
  'a miss before 2026-09-27 is not counted');

select is((select count(*)::int from public.black_money_member_misses
            where alliance_external_id = 'b1550000000000000000000000000001'
            group by alliance_external_id having count(*) <> count(distinct game_uid)), null::int,
  'one row per person');

-- (901's 10-11 listing, with no report, is why starter_battles above is 2
-- and not 3: an unreported battle is not counted either way.)
set local role anon;
select throws_ok($$ select game_uid from public.black_money_member_misses $$,
  '42501', null, 'anon reads no misses');
reset role;

set local role authenticated;
select is_empty($$ select game_uid from public.black_money_member_misses $$,
  'a signed-in request with no member role reads no misses');
reset role;

select * from finish();
rollback;
