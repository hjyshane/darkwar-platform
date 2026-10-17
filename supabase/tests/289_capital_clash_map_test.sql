-- 0289: Capital Clash judged by where each member's city was during the battle.
--
-- A battle on 2026-11-07, 14:00:00 to 15:20:00 UTC (made up for the test; the
-- real 10-17 row is in the migration). Cities are seen in the capital block
-- (x, y 470-520) or at home (x 440, y 390).
--
--   Alpha    in the capital at 14:30                       -> present
--   Bravo    only ever outside, last seen 15:10            -> ABSENT
--   Charlie  outside at 14:10, never seen again            -> not known
--   Delta    in the capital at 13:50 (closed), outside
--            at 15:12                                      -> ABSENT (the early sighting is ignored)
--   Echo     in the capital at 13:50, never seen after     -> not known
--   Foxtrot  teleported in at 13:55 (closed), outside
--            at 15:10                                      -> ABSENT (the early move is ignored)
--   Golf     on the score board, seen outside at 15:10     -> present (the board wins)
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000e901', 580, 'ext-cm', 'MapTest', true, 7);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000e901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level)
select ('00000000-0000-4000-8000-00000000e1' || lpad(v.n::text, 2, '0'))::uuid, 580,
       9270000000000000 + v.n, v.name, 50, 20
from (values (1,'Alpha'),(2,'Bravo'),(3,'Charlie'),(4,'Delta'),(5,'Echo'),(6,'Foxtrot'),(7,'Golf'))
  as v(n, name);

-- One batch, one captured_at (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000e0b1', 'al.rank', 'test',
       'test:289:roster:' || p.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000e901', 580, p.player_id,
       p.game_uid, p.current_name, 3, 30, 1, false, 'online'
from public.players p where p.game_uid between 9270000000000001 and 9270000000000007;

insert into public.capital_clash_windows (held_on, starts_at, ends_at)
values ('2026-11-07', '2026-11-07 14:00Z', '2026-11-07 15:20Z');

create function pg_temp.seen(n int, at timestamptz, x int, y int)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     point_id, x, y)
  values ('00000000-0000-4000-8000-00000000e0b2', 'world.get.new', 'test',
          'test:289:seen:' || n || ':' || at::text, at,
          '00000000-0000-4000-8000-000000000c01', 580, 580,
          ('00000000-0000-4000-8000-00000000e1' || lpad(n::text, 2, '0'))::uuid,
          9270000000000000 + n, y * 1000 + x + 1, x, y);
$$;

select pg_temp.seen(1, '2026-11-07 14:30Z', 495, 495);
select pg_temp.seen(2, '2026-11-07 15:10Z', 440, 390);
select pg_temp.seen(3, '2026-11-07 14:10Z', 440, 390);
select pg_temp.seen(4, '2026-11-07 13:50Z', 495, 495);
select pg_temp.seen(4, '2026-11-07 15:12Z', 440, 390);
select pg_temp.seen(5, '2026-11-07 13:50Z', 495, 495);
select pg_temp.seen(6, '2026-11-07 15:10Z', 440, 390);
select pg_temp.seen(7, '2026-11-07 15:10Z', 440, 390);

-- Foxtrot's move into the block at 13:55, while the capital was closed.
insert into public.player_relocations
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, server_id, game_uid, point_id)
values (gen_random_uuid(), '00000000-0000-4000-8000-00000000e0b3',
        'push.world.point.update', 'test', 'test:289:move',
        '2026-11-07 13:55Z', '00000000-0000-4000-8000-000000000c01', 580, 580,
        9270000000000006, 495 * 1000 + 496);

insert into public.capital_clash_scores
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, server_id, game_uid,
   held_on, alliance_code, rank, score)
values (gen_random_uuid(), '00000000-0000-4000-8000-00000000e0b4',
        'get.kingdom.act.score.rank', 'test', 'test:289:board',
        '2026-11-07 15:00Z', '00000000-0000-4000-8000-000000000c01', 580, 580,
        9270000000000007, '2026-11-07', 'TST', 5, 123456);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000e301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000e302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e301', 'member', 'cm member'),
  ('00000000-0000-4000-8000-00000000e302', 'viewer', 'cm viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;
create function pg_temp.tally(who text) returns jsonb language sql as $$
  select r.typed_events -> 'capital_clash'
    from public.member_participation('2026-11-02T02:00:00Z', '2026-11-09T02:00:00Z') r
   where r.current_name = who;
$$;

-- 1-3. The block, on a city and on a point id.
select ok(public.in_capital_zone(495, 495), 'a city inside the block');
select ok(not public.in_capital_zone(440, 390), 'a home city is not');
select ok(public.in_capital_zone(495 * 1000 + 496) and not public.in_capital_zone(389442),
  'a point id reads as y * 1000 + x + 1');

select pg_temp.act_as('00000000-0000-4000-8000-00000000e301');
set local role authenticated;

-- 4-10. The verdicts.
select is(pg_temp.tally('Alpha'), '{"held": 1, "attended": 1, "missed": 0, "score": null}'::jsonb,
  'a city inside the capital while the battle ran is present');
select is(pg_temp.tally('Bravo'), '{"held": 1, "attended": 0, "missed": 1, "score": null}'::jsonb,
  'seen outside in the last minutes, and nowhere else, is absent');
select is(pg_temp.tally('Charlie'), '{"held": 1, "attended": 0, "missed": 0, "score": null}'::jsonb,
  'seen outside only early could have teleported in later: not known');
select is(pg_temp.tally('Delta'), '{"held": 1, "attended": 0, "missed": 1, "score": null}'::jsonb,
  'a sighting in the capital before the start is ignored');
select is(pg_temp.tally('Echo'), '{"held": 1, "attended": 0, "missed": 0, "score": null}'::jsonb,
  'seen only in the closed hours and never after: not known');
select is(pg_temp.tally('Foxtrot'), '{"held": 1, "attended": 0, "missed": 1, "score": null}'::jsonb,
  'a teleport made while the capital was closed does not count');
select is(pg_temp.tally('Golf'), '{"held": 1, "attended": 1, "missed": 0, "score": 123456}'::jsonb,
  'the score board wins over being seen outside');

-- 11-12. Members read the window and cannot change it.
select ok((select count(*) from public.capital_clash_windows) >= 2, 'a member reads the windows');
select throws_ok($$ delete from public.capital_clash_windows $$, '42501', null,
  'a member cannot change them');

-- 13-14. A viewer reads nothing, anon has no read.
select pg_temp.act_as('00000000-0000-4000-8000-00000000e302');
select is((select count(*)::int from public.capital_clash_windows), 0, 'a viewer reads no window');
reset role;
select ok(not has_table_privilege('anon', 'public.capital_clash_windows', 'select'),
  'anon has no read on the windows');

select * from finish();
rollback;
