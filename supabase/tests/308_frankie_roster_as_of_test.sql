-- 0308: Frankie's members are the roster ON THE DAY, not today's.
--
-- Alpha and Bravo are members throughout. Delta is in the alliance for the
-- 10-05 event and has left by 10-15. Charlie joins after 10-15 and is in the
-- 10-19 event. Roster batches: 10-04 (A, B, D), 10-15 (A, B), 10-20 (A, B, C).
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-0000000e3001', 580, 'ext-asof', 'AsOfTest', true, 3);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-0000000e3001"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-0000000e3101', 580, 9500000000003101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-0000000e3102', 580, 9500000000003102, 'Bravo', 80, 29),
  ('00000000-0000-4000-8000-0000000e3103', 580, 9500000000003103, 'Charlie', 70, 28),
  ('00000000-0000-4000-8000-0000000e3104', 580, 9500000000003104, 'Delta', 60, 27),
  ('00000000-0000-4000-8000-0000000e3105', 580, 9500000000003105, 'Outsider', 50, 26);

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-0000000e30b1', 'al.rank', 'test',
       'test:308:roster:' || v.at || ':' || v.game_uid, v.at::timestamptz,
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-0000000e3001', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('2026-10-04T12:00:00Z', '00000000-0000-4000-8000-0000000e3101'::uuid, 9500000000003101::bigint, 'Alpha'),
    ('2026-10-04T12:00:00Z', '00000000-0000-4000-8000-0000000e3102'::uuid, 9500000000003102::bigint, 'Bravo'),
    ('2026-10-04T12:00:00Z', '00000000-0000-4000-8000-0000000e3104'::uuid, 9500000000003104::bigint, 'Delta'),
    ('2026-10-15T12:00:00Z', '00000000-0000-4000-8000-0000000e3101'::uuid, 9500000000003101::bigint, 'Alpha'),
    ('2026-10-15T12:00:00Z', '00000000-0000-4000-8000-0000000e3102'::uuid, 9500000000003102::bigint, 'Bravo'),
    ('2026-10-20T12:00:00Z', '00000000-0000-4000-8000-0000000e3101'::uuid, 9500000000003101::bigint, 'Alpha'),
    ('2026-10-20T12:00:00Z', '00000000-0000-4000-8000-0000000e3102'::uuid, 9500000000003102::bigint, 'Bravo'),
    ('2026-10-20T12:00:00Z', '00000000-0000-4000-8000-0000000e3103'::uuid, 9500000000003103::bigint, 'Charlie')
  ) as v(at, player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000e3301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'asof-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000e3301', 'member', 'asof member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.alliance_event_times
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, event_key, slot,
   alliance_id, starts_at)
values
  ('00000000-0000-4000-8000-0000000e3201', '00000000-0000-4000-8000-0000000e30b2',
   'get.alliance.boss.activity.info.new', 'test', 'test:308:t1', '2026-10-04T16:57:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 'bio_mutant', 1,
   '00000000-0000-4000-8000-0000000e3001', '2026-10-05T02:30:00Z'),
  ('00000000-0000-4000-8000-0000000e3202', '00000000-0000-4000-8000-0000000e30b3',
   'get.alliance.boss.activity.info.new', 'test', 'test:308:t2', '2026-10-18T02:52:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 'bio_mutant', 1,
   '00000000-0000-4000-8000-0000000e3001', '2026-10-19T02:30:00Z');

-- 10-05: Alpha and Delta on the board. 10-19: Alpha, Charlie, and Outsider
-- (never in this alliance's roster).
insert into public.boss_damage_scores
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, server_id, player_id,
   game_uid, held_on, rank, damage)
values
  ('00000000-0000-4000-8000-0000000e3401', '00000000-0000-4000-8000-0000000e30c1',
   'alliance.boss.damage.rank.new', 'test', 'test:308:s1', '2026-10-05T15:35:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-0000000e3101',
   9500000000003101, '2026-10-05', 1, 100),
  ('00000000-0000-4000-8000-0000000e3402', '00000000-0000-4000-8000-0000000e30c1',
   'alliance.boss.damage.rank.new', 'test', 'test:308:s2', '2026-10-05T15:35:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-0000000e3104',
   9500000000003104, '2026-10-05', 2, 30),
  ('00000000-0000-4000-8000-0000000e3403', '00000000-0000-4000-8000-0000000e30c2',
   'alliance.boss.damage.rank.new', 'test', 'test:308:s3', '2026-10-19T15:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-0000000e3101',
   9500000000003101, '2026-10-19', 1, 200),
  ('00000000-0000-4000-8000-0000000e3404', '00000000-0000-4000-8000-0000000e30c2',
   'alliance.boss.damage.rank.new', 'test', 'test:308:s4', '2026-10-19T15:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-0000000e3103',
   9500000000003103, '2026-10-19', 2, 80),
  ('00000000-0000-4000-8000-0000000e3405', '00000000-0000-4000-8000-0000000e30c2',
   'alliance.boss.damage.rank.new', 'test', 'test:308:s5', '2026-10-19T15:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-0000000e3105',
   9500000000003105, '2026-10-19', 3, 10);

set local role anon;
select throws_ok($$select count(*) from public.alliance_membership_history()$$, '42501', null,
  'anon cannot read who was in the alliance');
reset role;

select pg_temp.act_as('00000000-0000-4000-8000-0000000e3301');
set local role authenticated;
select is((select count(*) from public.alliance_membership_history()), 8::bigint,
  'a member reads who was in the alliance when');
select is((select count(*) from public.alliance_member_snapshots), 0::bigint,
  'while the table under it still shows a member nobody else''s history');
create temp table r on commit drop as select * from public.boss_damage_by_event();

select is((select string_agg(current_name, ',' order by current_name) from r
            where event_day = '2026-10-05'),
  'Alpha,Bravo,Delta', '10-05 is the roster of the day: Delta is in, Charlie has not joined');
select is((select string_agg(current_name, ',' order by current_name) from r
            where event_day = '2026-10-19'),
  'Alpha,Bravo,Charlie', '10-19: Charlie is in, Delta has left');
select is((select damage from r
            where event_day = '2026-10-05' and current_name = 'Delta'),
  30::bigint, 'and the damage of somebody who has since left still counts');
select ok((select damage is null from r
            where event_day = '2026-10-05' and current_name = 'Bravo'),
  'a member on the roster with no damage is a null cell');
select is((select count(*) from r where current_name = 'Charlie' and event_day = '2026-10-05'),
  0::bigint, 'a later joiner has no cell on an earlier event');
select is((select count(*) from r where current_name = 'Outsider'),
  0::bigint, 'somebody never on the roster is not reported');
select is((select count(*) from r where event_day = '2026-10-19'), 3::bigint,
  'the roster of the day is not today''s three-member roster stretched over every date');
select is((select count(distinct event_day) from r), 2::bigint, 'two events');

select * from finish();
rollback;
