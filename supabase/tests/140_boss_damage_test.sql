-- 0276: the Frankie damage board and boss_damage_by_event.
--
-- Two Frankie events: 10-05 and 10-11 (each starts 02:30 UTC). Alpha and Bravo
-- are members; Outsider is not on the roster.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000d901', 580, 'ext-bd', 'BossTest', true, 2);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000d901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000d101', 580, 9500000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000d102', 580, 9500000000000102, 'Bravo', 80, 29),
  ('00000000-0000-4000-8000-00000000d103', 580, 9500000000000103, 'Outsider', 70, 28);

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000d0b1', 'al.rank', 'test',
       'test:140:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000d901', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000d101'::uuid, 9500000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000d102'::uuid, 9500000000000102::bigint, 'Bravo')
  ) as v(player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000d301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bd-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000d301', 'member', 'bd member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Frankie starts, as the collector read them from the game.
insert into public.alliance_event_times
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, event_key, slot,
   alliance_id, starts_at)
values
  ('00000000-0000-4000-8000-00000000d201', '00000000-0000-4000-8000-00000000d0b2',
   'get.alliance.boss.activity.info.new', 'test', 'test:140:t1', '2026-10-04T16:57:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 'bio_mutant', 1,
   '00000000-0000-4000-8000-00000000d901', '2026-10-05T02:30:00Z'),
  ('00000000-0000-4000-8000-00000000d202', '00000000-0000-4000-8000-00000000d0b3',
   'get.alliance.boss.activity.info.new', 'test', 'test:140:t2', '2026-10-10T02:52:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 'bio_mutant', 1,
   '00000000-0000-4000-8000-00000000d901', '2026-10-11T02:30:00Z');

-- Board reads. 10-05: read right after the event (Alpha 100, Bravo 50), then
-- again with more damage. 10-11: read on the 12th, a day after, plus somebody
-- who is not on the roster.
insert into public.boss_damage_scores
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, server_id, player_id,
   game_uid, held_on, rank, damage)
values
  ('00000000-0000-4000-8000-00000000d401', '00000000-0000-4000-8000-00000000d0c1',
   'alliance.boss.damage.rank.new', 'test', 'test:140:s1', '2026-10-05T15:35:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-00000000d101',
   9500000000000101, '2026-10-05', 1, 100),
  ('00000000-0000-4000-8000-00000000d402', '00000000-0000-4000-8000-00000000d0c1',
   'alliance.boss.damage.rank.new', 'test', 'test:140:s2', '2026-10-05T15:35:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-00000000d102',
   9500000000000102, '2026-10-05', 2, 50),
  ('00000000-0000-4000-8000-00000000d403', '00000000-0000-4000-8000-00000000d0c2',
   'alliance.boss.damage.rank.new', 'test', 'test:140:s3', '2026-10-05T15:46:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-00000000d101',
   9500000000000101, '2026-10-05', 1, 120),
  ('00000000-0000-4000-8000-00000000d404', '00000000-0000-4000-8000-00000000d0c3',
   'alliance.boss.damage.rank.new', 'test', 'test:140:s4', '2026-10-12T05:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-00000000d102',
   9500000000000102, '2026-10-12', 1, 700),
  ('00000000-0000-4000-8000-00000000d405', '00000000-0000-4000-8000-00000000d0c3',
   'alliance.boss.damage.rank.new', 'test', 'test:140:s5', '2026-10-12T05:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-00000000d103',
   9500000000000103, '2026-10-12', 2, 600);

-- ------------------------------------------------------------- access

set local role anon;
select throws_ok($$select count(*) from public.boss_damage_scores$$, '42501', null,
  'anon cannot read the board');
reset role;

select pg_temp.act_as('00000000-0000-4000-8000-00000000d301');
set local role authenticated;
select lives_ok($$select count(*) from public.boss_damage_scores$$, 'a member can read it');
select throws_ok(
  $$insert into public.boss_damage_scores (snapshot_id) values (gen_random_uuid())$$,
  '42501', null, 'and cannot write it');

-- ------------------------------------------------------------- the report

create temp table r on commit drop as
  select * from public.boss_damage_by_event();

select is((select damage from r
            where event_day = '2026-10-05' and player_id = '00000000-0000-4000-8000-00000000d101'),
  120::bigint, 'a later read of the same event replaces the earlier one');
select is((select damage from r
            where event_day = '2026-10-11' and player_id = '00000000-0000-4000-8000-00000000d102'),
  700::bigint, 'a read the next day belongs to the Frankie start it followed (10-11)');
select is((select count(*) from r where player_id = '00000000-0000-4000-8000-00000000d103'),
  0::bigint, 'a board entry for somebody not on the roster is not reported');
select is((select count(*) from r), 4::bigint, 'two members against two events is four cells');
select ok((select damage is null from r
            where event_day = '2026-10-11' and player_id = '00000000-0000-4000-8000-00000000d101'),
  'a member with nothing on an event that has damage is a null cell, not a missing row');

-- A typed row fills a day nobody captured; a captured row beats it.
reset role;
insert into public.event_attendance (alliance_id, kind, held_on, player_id, attended, damage) values
  ('00000000-0000-4000-8000-00000000d901', 'frankie', '2026-10-02',
   '00000000-0000-4000-8000-00000000d101', true, 40),
  ('00000000-0000-4000-8000-00000000d901', 'frankie', '2026-10-11',
   '00000000-0000-4000-8000-00000000d102', true, 5);
select pg_temp.act_as('00000000-0000-4000-8000-00000000d301');
set local role authenticated;
create temp table r2 on commit drop as select * from public.boss_damage_by_event();
select is((select damage || '/' || source from r2
            where event_day = '2026-10-02' and player_id = '00000000-0000-4000-8000-00000000d101'),
  '40/typed', 'a typed damage fills an event nobody captured');
select is((select damage || '/' || source from r2
            where event_day = '2026-10-11' and player_id = '00000000-0000-4000-8000-00000000d102'),
  '700/captured', 'and a captured one wins for the same member and day');

select * from finish();
rollback;
