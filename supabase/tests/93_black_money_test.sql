-- 0178: the three Black Money tables follow the snapshot conventions, stay
-- member-only, and a report copy from a second inbox cannot land twice.
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

select has_column('public', t.tab, c.col, t.tab || ' has ' || c.col)
from unnest(array['black_money_signup_snapshots', 'black_money_battle_snapshots',
                  'black_money_score_snapshots']) as t(tab)
cross join unnest(array['observation_id', 'source_command', 'parser_version',
                        'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'black_money_signup_snapshots', 'idempotency_key',
  'signup idempotency_key is unique');
select col_is_unique('public', 'black_money_battle_snapshots', 'idempotency_key',
  'battle idempotency_key is unique');
select col_is_unique('public', 'black_money_score_snapshots', 'idempotency_key',
  'score idempotency_key is unique');

-- A signup reading: one starter on A, one substitute on B, one on neither.
insert into public.black_money_signup_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, game_uid, name,
   state, team_index, time_index_record)
values
  ('00000000-0000-4000-8000-00000000f931', 'dragon.assign.player.info', 'test',
   't:bms:1', '2026-09-27T13:07:12Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, 9100000001000580, 'Starter', 1, 1, '3'),
  ('00000000-0000-4000-8000-00000000f931', 'dragon.assign.player.info', 'test',
   't:bms:2', '2026-09-27T13:07:12Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, 9100000002000580, 'Sub', 2, 2, '2;3'),
  ('00000000-0000-4000-8000-00000000f931', 'dragon.assign.player.info', 'test',
   't:bms:3', '2026-09-27T13:07:12Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, 9100000003000580, 'Nobody', 0, null, null);

select is((select count(*)::int from public.black_money_signup_snapshots
           where idempotency_key like 't:bms:%' and team_index is null), 1,
  'a member on neither team lands with a null team');

insert into public.black_money_battle_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, alliance_external_id,
   battle_ended_at, team_index, state, score, user_num, max_user_num,
   enemy_name, enemy_score, enemy_user_num)
values
  ('00000000-0000-4000-8000-00000000f932', 'dragon.battle.history', 'test',
   't:bmb:1', '2026-09-27T13:08:25Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, '0123456789abcdef0123456789abcdef',
   '2026-09-27T12:50:00Z', 2, 2, 382529, 21, 20, 'Them', 284451, 22);

select is((select user_num from public.black_money_battle_snapshots
           where idempotency_key = 't:bmb:1'), 21,
  'a team result keeps how many entered, which can exceed the starter cap');

-- An opponent on a server outside the seed must be refused until sync
-- registers it — the FK is what forces ensure_servers() to run.
select throws_ok($$
  insert into public.black_money_score_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid,
     alliance_external_id, reported_at, score)
  values
    ('00000000-0000-4000-8000-00000000f933', 'chat.get.system.mails', 'test',
     't:bmp:x', '2026-09-27T13:03:05Z', '00000000-0000-4000-8000-000000000c01',
     580, 9999, 9100000009009999, 'fedcba9876543210fedcba9876543210',
     '2026-09-27T12:54:05Z', 1)
$$, '23503', null, 'a score naming an unregistered server is refused');

insert into public.black_money_score_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, game_uid,
   alliance_external_id, side, win, reported_at, score, kill_score)
values
  ('00000000-0000-4000-8000-00000000f933', 'chat.get.system.mails', 'test',
   't:bmp:1', '2026-09-27T13:03:05Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, 9100000001000580, '0123456789abcdef0123456789abcdef',
   0, 1, '2026-09-27T12:54:05Z', 578571, 375371);

-- The collector gives both recipients' copies of one report the same key.
-- The second copy must be refused by the table, not merely by the parser.
select throws_ok($$
  insert into public.black_money_score_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid,
     alliance_external_id, reported_at, score)
  values
    ('00000000-0000-4000-8000-00000000f934', 'chat.get.system.mails', 'test',
     't:bmp:1', '2026-09-27T14:00:00Z', '00000000-0000-4000-8000-000000000c01',
     580, 580, 9100000001000580, '0123456789abcdef0123456789abcdef',
     '2026-09-27T12:54:05Z', 578571)
$$, '23505', null, 'a second inbox''s copy of a report cannot land twice');

-- The collector writes as service_role, and pgTAP runs as the migration
-- owner — so a missing grant would pass everything above.
set local role service_role;
select lives_ok($$
  insert into public.black_money_battle_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, alliance_external_id,
     battle_ended_at, team_index)
  values
    ('00000000-0000-4000-8000-00000000f935', 'dragon.battle.history', 'test',
     't:bmb:2', '2026-09-27T13:08:25Z', '00000000-0000-4000-8000-000000000c01',
     580, 580, '0123456789abcdef0123456789abcdef', '2026-09-13T21:50:00Z', 1)
$$, 'service_role can write a team result');
reset role;

-- 0065: nothing is public. anon holds no grant and fails loudly.
set local role anon;
select throws_ok($$ select snapshot_id from public.black_money_signup_snapshots $$,
  '42501', null, 'anon reads no signups');
select throws_ok($$ select snapshot_id from public.black_money_battle_snapshots $$,
  '42501', null, 'anon reads no team results');
select throws_ok($$ select snapshot_id from public.black_money_score_snapshots $$,
  '42501', null, 'anon reads no player scores');
reset role;

-- Signed in is not enough: with no member role the policy returns nothing.
set local role authenticated;
select is_empty($$ select snapshot_id from public.black_money_signup_snapshots $$,
  'a signed-in request with no member role reads no signups');
select is_empty($$ select snapshot_id from public.black_money_battle_snapshots $$,
  'a signed-in request with no member role reads no team results');
select is_empty($$ select snapshot_id from public.black_money_score_snapshots $$,
  'a signed-in request with no member role reads no player scores');
reset role;

select * from finish();
rollback;
