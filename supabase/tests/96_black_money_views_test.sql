-- 0181: a battle is read against the right signup reading and the right
-- report, one row per person, and "played" is unknown without a report.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- Our alliance, one event: team B ends 12:50, team A ends 21:50.
create function pg_temp.battle(key text, ended timestamptz, team int, score bigint, entered int)
returns void language sql as $$
  insert into public.black_money_battle_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, alliance_external_id,
     battle_ended_at, team_index, state, score, user_num, max_user_num, enemy_name, enemy_score)
  values ('00000000-0000-4000-8000-00000000f961', 'dragon.battle.history', 'test', key,
          '2026-09-28T00:00:00Z', '00000000-0000-4000-8000-000000000c01', 580, 580,
          'b1ac0000000000000000000000000001', ended, team, 2, score, entered, 20, 'Them', 1);
$$;

create function pg_temp.signup(key text, at timestamptz, uid bigint, team int, state int)
returns void language sql as $$
  insert into public.black_money_signup_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, name, state, team_index)
  values ('00000000-0000-4000-8000-00000000f962', 'dragon.assign.player.info', 'test', key,
          at, '00000000-0000-4000-8000-000000000c01', 580, 580, uid, 'P' || uid, state, team);
$$;

create function pg_temp.score(key text, sent timestamptz, uid bigint, alliance text, points bigint)
returns void language sql as $$
  insert into public.black_money_score_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, name,
     alliance_external_id, side, win, reported_at, score, kill_score)
  values ('00000000-0000-4000-8000-00000000f963', 'chat.get.system.mails', 'test', key,
          sent + interval '5 minutes', '00000000-0000-4000-8000-000000000c01', 580, 580,
          uid, 'P' || uid, alliance, 0, 1, sent, points, points);
$$;

-- A battle history reading, and the same battle read again later: one row.
select pg_temp.battle('t:bmv:b1', '2026-09-27T12:50:00Z', 2, 382529, 21);
select pg_temp.battle('t:bmv:b1again', '2026-09-27T12:50:00Z', 2, 382529, 21);
select pg_temp.battle('t:bmv:a1', '2026-09-27T21:50:00Z', 1, 500000, 19);

-- A STALE reading 10 days before, which must not be used...
select pg_temp.signup('t:bmv:s0', '2026-09-17T12:00:00Z', 9001000000000580, 2, 1);
-- ...the real reading, the morning of the event: 101 starter and 102 sub on
-- B, 201 starter on A...
select pg_temp.signup('t:bmv:s1', '2026-09-27T09:00:00Z', 9101000000000580, 2, 1);
select pg_temp.signup('t:bmv:s2', '2026-09-27T09:00:00Z', 9102000000000580, 2, 2);
select pg_temp.signup('t:bmv:s3', '2026-09-27T09:00:00Z', 9201000000000580, 1, 1);
-- ...and a reading AFTER team B ended, which B must not use but A must.
select pg_temp.signup('t:bmv:s4', '2026-09-27T15:00:00Z', 9201000000000580, 1, 1);
select pg_temp.signup('t:bmv:s5', '2026-09-27T15:00:00Z', 9202000000000580, 1, 2);

-- Team B's report: the starter played, the sub did not, and 103 played
-- without being on the list. An opponent's row must not count as ours.
select pg_temp.score('t:bmv:p1', '2026-09-27T12:54:05Z', 9101000000000580,
                     'b1ac0000000000000000000000000001', 578571);
select pg_temp.score('t:bmv:p3', '2026-09-27T12:54:05Z', 9103000000000580,
                     'b1ac0000000000000000000000000001', 1000);
select pg_temp.score('t:bmv:px', '2026-09-27T12:54:05Z', 9999000000000581,
                     'e0e00000000000000000000000000001', 99);
-- No report for team A.

select is((select count(*)::int from public.black_money_battles
            where alliance_external_id = 'b1ac0000000000000000000000000001'), 2,
  'a battle read twice from the history is one battle');

select is((select signup_read_at from public.black_money_battles where team_index = 2
             and alliance_external_id = 'b1ac0000000000000000000000000001'),
          '2026-09-27T09:00:00Z'::timestamptz,
  'team B is read against the last signup reading before it ended');

select is((select signup_read_at from public.black_money_battles where team_index = 1
             and alliance_external_id = 'b1ac0000000000000000000000000001'),
          '2026-09-27T15:00:00Z'::timestamptz,
  'team A is read against a later reading, still before it ended');

select is((select (starters, substitutes)::text from public.black_money_battles
            where team_index = 2 and alliance_external_id = 'b1ac0000000000000000000000000001'),
          '(1,1)', 'team B had one starter and one substitute on its list');

select is((select report_seen from public.black_money_battles where team_index = 1
             and alliance_external_id = 'b1ac0000000000000000000000000001'), false,
  'no report was captured for team A');

select is((select players_scored::int from public.black_money_battles where team_index = 2
             and alliance_external_id = 'b1ac0000000000000000000000000001'), 2,
  'team B''s report counts our players only');

-- The member view, team B: three people, one row each.
select is((select count(*)::int from public.black_money_battle_members
            where team_index = 2 and alliance_external_id = 'b1ac0000000000000000000000000001'
              and battle_ended_at = '2026-09-27T12:50:00Z'), 3,
  'one row per person: two listed, one who played unlisted');

select is((select played from public.black_money_battle_members
            where game_uid = 9101000000000580 and team_index = 2), true,
  'the starter who scored played');

select is((select played from public.black_money_battle_members
            where game_uid = 9102000000000580 and team_index = 2), false,
  'the substitute absent from the report did not play');

select is((select slot from public.black_money_battle_members
            where game_uid = 9103000000000580 and team_index = 2), null::text,
  'a player who scored without being listed has no slot');

select is((select count(*)::int from public.black_money_battle_members
            where game_uid = 9001000000000580), 0,
  'the stale reading from the previous event is not used');

select is((select count(*)::int from public.black_money_battle_members
            where team_index = 1 and played is not null
              and alliance_external_id = 'b1ac0000000000000000000000000001'), 0,
  'without a report, played is unknown rather than false');

-- Access follows the underlying tables.
set local role anon;
select throws_ok($$ select team_index from public.black_money_battles $$,
  '42501', null, 'anon reads no battles');
reset role;

set local role authenticated;
select is_empty($$ select game_uid from public.black_money_battle_members $$,
  'a signed-in request with no member role reads no battle members');
reset role;

select * from finish();
rollback;
