-- 0288: Frankie counted round by round.
--
-- Event day 2026-10-17: round 1 15:45-16:17, round 2 01:15-01:47 next morning.
-- The board is opened during round 1 (16:00), after it (16:20, before round 2)
-- and after round 2 (01:50). Event day 2026-10-20 has only a live read during
-- round 1, so nothing can be said about who did NOT hit.
--
--   Alpha   hit round 1 only (50 live, 100 by 16:20, unchanged after)
--   Bravo   not there in round 1, 400 by the end
--   Charlie both rounds: 100, then 300
--   Delta   on the board at 0 all event
--   Echo    never on the board (and an officer's tick must not matter here)
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000d901', 580, 'ext-fr', 'FrankieTest', true, 5);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000d901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000d101', 580, 9260000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000d102', 580, 9260000000000102, 'Bravo', 80, 29),
  ('00000000-0000-4000-8000-00000000d103', 580, 9260000000000103, 'Charlie', 70, 28),
  ('00000000-0000-4000-8000-00000000d104', 580, 9260000000000104, 'Delta', 60, 27),
  ('00000000-0000-4000-8000-00000000d105', 580, 9260000000000105, 'Echo', 50, 26);

-- One batch, one captured_at (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000d0b1', 'al.rank', 'test',
       'test:288:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000d901', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000d101'::uuid, 9260000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000d102'::uuid, 9260000000000102::bigint, 'Bravo'),
    ('00000000-0000-4000-8000-00000000d103'::uuid, 9260000000000103::bigint, 'Charlie'),
    ('00000000-0000-4000-8000-00000000d104'::uuid, 9260000000000104::bigint, 'Delta'),
    ('00000000-0000-4000-8000-00000000d105'::uuid, 9260000000000105::bigint, 'Echo')
  ) as v(player_id, game_uid, name);

create function pg_temp.slot(key text, n int, starts timestamptz, ends timestamptz, seen timestamptz)
returns void language sql as $$
  insert into public.alliance_event_times
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, event_key, slot, alliance_id, starts_at, ends_at)
  values ('00000000-0000-4000-8000-00000000d0b2', 'get.alliance.boss.activity.info.new',
          'test', 'test:288:slot:' || key, seen,
          '00000000-0000-4000-8000-000000000c01', 580, 'bio_mutant', n,
          '00000000-0000-4000-8000-00000000d901', starts, ends);
$$;
create function pg_temp.read(key text, at timestamptz)
returns void language sql as $$
  insert into public.boss_damage_reads
    (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, held_on, entries, hitters,
     total_damage)
  values (gen_random_uuid(), '00000000-0000-4000-8000-00000000d0b3',
          'alliance.boss.damage.rank.new', 'test', 'test:288:read:' || key, at,
          '00000000-0000-4000-8000-000000000c01', 580, (at - interval '2 hours')::date,
          1, 1, 1);
$$;
create function pg_temp.hit(key text, who uuid, uid bigint, at timestamptz, dmg bigint)
returns void language sql as $$
  insert into public.boss_damage_scores
    (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, server_id, player_id,
     game_uid, held_on, damage)
  values (gen_random_uuid(), '00000000-0000-4000-8000-00000000d0b4',
          'alliance.boss.damage.rank.new', 'test', 'test:288:hit:' || key, at,
          '00000000-0000-4000-8000-000000000c01', 580, 580, who, uid,
          (at - interval '2 hours')::date, dmg);
$$;

-- Event 10-17. The first announcement said 15:30; the latest seen wins.
select pg_temp.slot('a1', 1, '2026-10-17 15:30Z', '2026-10-17 16:02Z', '2026-10-17 10:00Z');
select pg_temp.slot('a2', 1, '2026-10-17 15:45Z', '2026-10-17 16:17Z', '2026-10-17 15:40Z');
select pg_temp.slot('a3', 2, '2026-10-18 01:15Z', '2026-10-18 01:47Z', '2026-10-17 15:40Z');
-- Event 10-20: only a live read during round 1.
select pg_temp.slot('b1', 1, '2026-10-20 15:00Z', '2026-10-20 15:32Z', '2026-10-20 14:00Z');
select pg_temp.slot('b2', 2, '2026-10-21 01:30Z', '2026-10-21 02:02Z', '2026-10-20 14:00Z');

select pg_temp.read('r1', '2026-10-17 16:00Z');
select pg_temp.read('r2', '2026-10-17 16:20Z');
select pg_temp.read('r3', '2026-10-18 01:50Z');
select pg_temp.read('x1', '2026-10-20 15:10Z');

select pg_temp.hit('a-live', '00000000-0000-4000-8000-00000000d101', 9260000000000101, '2026-10-17 16:00Z', 50);
select pg_temp.hit('a-r1', '00000000-0000-4000-8000-00000000d101', 9260000000000101, '2026-10-17 16:20Z', 100);
select pg_temp.hit('c-r1', '00000000-0000-4000-8000-00000000d103', 9260000000000103, '2026-10-17 16:20Z', 100);
select pg_temp.hit('d-r1', '00000000-0000-4000-8000-00000000d104', 9260000000000104, '2026-10-17 16:20Z', 0);
select pg_temp.hit('b-end', '00000000-0000-4000-8000-00000000d102', 9260000000000102, '2026-10-18 01:50Z', 400);
select pg_temp.hit('c-end', '00000000-0000-4000-8000-00000000d103', 9260000000000103, '2026-10-18 01:50Z', 300);
-- Alpha's 100 and Delta's 0 were not re-sent at the end: nothing changed.
select pg_temp.hit('x-a', '00000000-0000-4000-8000-00000000d101', 9260000000000101, '2026-10-20 15:10Z', 70);

-- An officer's tick on a day that has rounds is ignored for Echo.
insert into public.event_attendance (kind, held_on, player_id, attended)
values ('frankie', '2026-10-17', '00000000-0000-4000-8000-00000000d105', true);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000d301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fr-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000d302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fr-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000d301', 'member', 'fr member'),
  ('00000000-0000-4000-8000-00000000d302', 'viewer', 'fr viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;
create function pg_temp.tally(who text) returns jsonb language sql as $$
  select r.typed_events -> 'frankie'
    from public.member_participation('2026-10-12T02:00:00Z', '2026-10-26T02:00:00Z') r
   where r.current_name = who;
$$;
create function pg_temp.round(day date, n int, who text) returns text language sql as $$
  select coalesce(f.attended::text, 'unknown') || ' ' || coalesce(f.damage::text, '-')
    from public.frankie_rounds(day, day) f
    join public.players p on p.player_id = f.player_id
   where f.round = n and p.current_name = who;
$$;

select ok((select captured from public.attendance_event_kinds where kind = 'frankie'),
  'Frankie is marked captured');

select pg_temp.act_as('00000000-0000-4000-8000-00000000d301');
set local role authenticated;

-- 2-6. Round 1 of 10-17, from the board as it stood when round 2 began.
select is(pg_temp.round('2026-10-17', 1, 'Alpha'), 'true 100', 'round 1: on the board is present, with round 1''s damage');
select is(pg_temp.round('2026-10-17', 1, 'Bravo'), 'false -', 'round 1: off the board after it closed is absent');
select is(pg_temp.round('2026-10-17', 1, 'Charlie'), 'true 100', 'round 1: Charlie hit');
select is(pg_temp.round('2026-10-17', 1, 'Delta'), 'false -', 'round 1: on the board at zero did not hit');

-- 7-10. Round 2: the damage that grew since.
select is(pg_temp.round('2026-10-17', 2, 'Alpha'), 'false -', 'round 2: unchanged is absent once the board is read after the end');
select is(pg_temp.round('2026-10-17', 2, 'Bravo'), 'true 400', 'round 2: new on the board is present');
select is(pg_temp.round('2026-10-17', 2, 'Charlie'), 'true 200',
  'round 2: somebody who hit both rounds is present, with the growth only');
select is(pg_temp.round('2026-10-17', 2, 'Echo'), 'false -', 'round 2: never on the board is absent');

-- 11-14. The report: held counts rounds; a day with only a live read can only
-- say who hit, never who did not.
select is(pg_temp.tally('Alpha'),
  '{"held": 3, "attended": 2, "missed": 1, "score": 170}'::jsonb,
  'Alpha: round 1 of 10-17, round 1 of 10-20 (live), missed round 2');
select is(pg_temp.tally('Charlie'),
  '{"held": 3, "attended": 2, "missed": 0, "score": 300}'::jsonb,
  'Charlie: both rounds of 10-17; 10-20''s round 1 is not known');
select is(pg_temp.tally('Echo'),
  '{"held": 3, "attended": 0, "missed": 2, "score": null}'::jsonb,
  'Echo: absent twice on 10-17 whatever the tick says; 10-20 not known');

select pg_temp.act_as('00000000-0000-4000-8000-00000000d302');
select is((select count(*)::int from public.boss_damage_reads), 0, 'a viewer reads no read rows');
reset role;

select ok(not has_table_privilege('anon', 'public.boss_damage_reads', 'select'),
  'anon has no read on the read rows');

select * from finish();
rollback;
