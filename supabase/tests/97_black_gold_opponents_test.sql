-- 0182: the opposing players of a battle are the report's other side, one
-- row per person, and access follows the underlying table.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.black_money_battle_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, alliance_external_id,
   battle_ended_at, team_index, state, score, user_num, max_user_num)
values ('00000000-0000-4000-8000-00000000f971', 'dragon.activity.info', 'test', 't:bgo:b1',
        '2026-09-27T22:09:00Z', '00000000-0000-4000-8000-000000000c01', 580, 580,
        'b16a0000000000000000000000000001', '2026-09-27T21:50:00Z', 1, 2, 615634, 17, 20);

create function pg_temp.score(key text, sent timestamptz, uid bigint, srv int, alliance text,
                              abbr text, points bigint, seen timestamptz)
returns void language sql as $$
  insert into public.black_money_score_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, name,
     alliance_external_id, alliance_abbr, side, win, reported_at, score)
  values ('00000000-0000-4000-8000-00000000f972', 'push.mail', 'test', key, seen,
          '00000000-0000-4000-8000-000000000c01', 580, srv, uid, 'P' || uid,
          alliance, abbr, 1, 0, sent, points);
$$;

-- Ours, and two opponents — one of them read twice.
select pg_temp.score('t:bgo:us', '2026-09-27T21:53:35Z', 9301000000000580, 580,
                     'b16a0000000000000000000000000001', 'US', 836376, '2026-09-27T21:53:40Z');
select pg_temp.score('t:bgo:t1', '2026-09-27T21:53:35Z', 9401000000000588, 588,
                     'e16a0000000000000000000000000001', 'THM', 90000, '2026-09-27T21:53:40Z');
select pg_temp.score('t:bgo:t1again', '2026-09-27T21:53:35Z', 9401000000000588, 588,
                     'e16a0000000000000000000000000001', 'THM', 90000, '2026-09-27T22:16:00Z');
select pg_temp.score('t:bgo:t2', '2026-09-27T21:53:35Z', 9402000000000588, 588,
                     'e16a0000000000000000000000000001', 'THM', 12000, '2026-09-27T21:53:40Z');
-- A report from a DIFFERENT battle, hours later, must not be counted here.
select pg_temp.score('t:bgo:later', '2026-09-28T04:00:00Z', 9403000000000588, 588,
                     'e16a0000000000000000000000000001', 'THM', 1, '2026-09-28T04:00:10Z');

select is((select count(*)::int from public.black_money_battle_opponents
            where alliance_external_id = 'b16a0000000000000000000000000001'), 2,
  'one row per opposing player, read twice or not');

select is((select count(*)::int from public.black_money_battle_opponents
            where game_uid = 9301000000000580), 0,
  'our own players are not on the other side');

select is((select count(*)::int from public.black_money_battle_opponents
            where game_uid = 9403000000000588), 0,
  'a report from another battle is not this one''s');

select is((select opponent_abbr from public.black_money_battle_opponents
            where game_uid = 9401000000000588), 'THM',
  'an opposing player carries their alliance');

set local role anon;
select throws_ok($$ select game_uid from public.black_money_battle_opponents $$,
  '42501', null, 'anon reads no opponents');
reset role;

set local role authenticated;
select is_empty($$ select game_uid from public.black_money_battle_opponents $$,
  'a signed-in request with no member role reads no opponents');
reset role;

select * from finish();
rollback;
