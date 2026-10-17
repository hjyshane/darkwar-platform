-- 0287: Capital Clash judged from its score board and from who teleported.
--
-- Week of Monday 2026-10-12, the clash on 10-17. Alpha is on the board twice
-- (the higher read wins). Bravo is off the board but teleported into the
-- capital's block. Charlie teleported somewhere else. Delta is on the board
-- but an officer ticked them absent. Echo has nothing: not known, never absent.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000c901', 580, 'ext-cc', 'ClashTest', true, 5);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000c901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000c101', 580, 9250000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000c102', 580, 9250000000000102, 'Bravo', 80, 29),
  ('00000000-0000-4000-8000-00000000c103', 580, 9250000000000103, 'Charlie', 70, 28),
  ('00000000-0000-4000-8000-00000000c104', 580, 9250000000000104, 'Delta', 60, 27),
  ('00000000-0000-4000-8000-00000000c105', 580, 9250000000000105, 'Echo', 50, 26);

-- One batch, one captured_at (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000c0b1', 'al.rank', 'test',
       'test:287:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000c901', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000c101'::uuid, 9250000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000c102'::uuid, 9250000000000102::bigint, 'Bravo'),
    ('00000000-0000-4000-8000-00000000c103'::uuid, 9250000000000103::bigint, 'Charlie'),
    ('00000000-0000-4000-8000-00000000c104'::uuid, 9250000000000104::bigint, 'Delta'),
    ('00000000-0000-4000-8000-00000000c105'::uuid, 9250000000000105::bigint, 'Echo')
  ) as v(player_id, game_uid, name);

create function pg_temp.board(key text, uid bigint, at timestamptz, pts bigint)
returns void language sql as $$
  insert into public.capital_clash_scores
    (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, server_id, game_uid,
     held_on, alliance_code, rank, score)
  values (gen_random_uuid(), '00000000-0000-4000-8000-00000000c0b2',
          'get.kingdom.act.score.rank', 'test', 'test:287:' || key, at,
          '00000000-0000-4000-8000-000000000c01', 580, 580, uid,
          '2026-10-17', 'TST', 1, pts);
$$;
create function pg_temp.moved(key text, uid bigint, at timestamptz, point bigint)
returns void language sql as $$
  insert into public.player_relocations
    (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, server_id, game_uid, point_id)
  values (gen_random_uuid(), '00000000-0000-4000-8000-00000000c0b3',
          'push.world.point.update', 'test', 'test:287:m:' || key, at,
          '00000000-0000-4000-8000-000000000c01', 580, 580, uid, point);
$$;

select pg_temp.board('a1', 9250000000000101, '2026-10-17 14:05Z', 1000);
select pg_temp.board('a2', 9250000000000101, '2026-10-17 15:03Z', 5000);
select pg_temp.board('d1', 9250000000000104, '2026-10-17 14:05Z', 700);
-- Bravo into the block (y 502, x 481); Charlie to y 389, x 442, outside it.
select pg_temp.moved('b', 9250000000000102, '2026-10-17 14:03Z', 502481);
select pg_temp.moved('c', 9250000000000103, '2026-10-17 15:21Z', 389442);
-- An officer's tick beats the board.
insert into public.event_attendance (kind, held_on, player_id, attended)
values ('capital_clash', '2026-10-17', '00000000-0000-4000-8000-00000000c104', false);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000c301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cc-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000c302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cc-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000c301', 'member', 'cc member'),
  ('00000000-0000-4000-8000-00000000c302', 'viewer', 'cc viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;
create function pg_temp.tally(who text) returns jsonb language sql as $$
  select r.typed_events -> 'capital_clash'
    from public.member_participation('2026-10-12T02:00:00Z', '2026-10-19T02:00:00Z') r
   where r.current_name = who;
$$;

-- 1. Marked captured.
select ok((select captured from public.attendance_event_kinds where kind = 'capital_clash'),
  'Capital Clash is marked captured');

-- 2-4. The zone.
select ok(public.in_capital_zone(502481), 'a point inside the block is in the capital');
select ok(not public.in_capital_zone(389442), 'the post-capture block is not');
select ok(not public.in_capital_zone(null), 'a missing point is not');

select pg_temp.act_as('00000000-0000-4000-8000-00000000c301');
set local role authenticated;

-- 5-9. The verdicts.
select is(pg_temp.tally('Alpha'),
  '{"held": 1, "attended": 1, "missed": 0, "score": 5000}'::jsonb,
  'on the board is present, with the highest read as the score');
select is(pg_temp.tally('Bravo'),
  '{"held": 1, "attended": 1, "missed": 0, "score": null}'::jsonb,
  'teleporting into the capital is present, with no score');
select is(pg_temp.tally('Charlie'),
  '{"held": 1, "attended": 0, "missed": 0, "score": null}'::jsonb,
  'teleporting elsewhere proves nothing');
select is(pg_temp.tally('Delta'),
  '{"held": 1, "attended": 0, "missed": 1, "score": null}'::jsonb,
  'an officer''s tick overrides the board, and its score with it');
select is(pg_temp.tally('Echo'),
  '{"held": 1, "attended": 0, "missed": 0, "score": null}'::jsonb,
  'on neither is NOT KNOWN, never absent: the board stops at the top 100');

-- 10-11. Members read what is theirs, and cannot write it.
select ok((select count(*) from public.capital_clash_scores) = 3
          and (select count(*) from public.player_relocations) = 2,
  'a member reads the board and the relocations');
select throws_ok($$ delete from public.capital_clash_scores $$, '42501', null,
  'a member cannot touch the board');
select throws_ok($$ delete from public.player_relocations $$, '42501', null,
  'nor the relocations');

-- 13-14. A viewer reads nothing.
select pg_temp.act_as('00000000-0000-4000-8000-00000000c302');
select is((select count(*)::int from public.capital_clash_scores), 0, 'a viewer reads no board');
select is((select count(*)::int from public.player_relocations), 0, 'nor the relocations');
reset role;

-- 15-16. Anon is refused outright.
select ok(not has_table_privilege('anon', 'public.capital_clash_scores', 'select'),
  'anon has no read on the board');
select ok(not has_table_privilege('anon', 'public.player_relocations', 'select'),
  'nor on the relocations');

select * from finish();
rollback;
