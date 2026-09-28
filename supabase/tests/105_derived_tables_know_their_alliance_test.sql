-- 0196: the roster cache, the rank build and the hive board each work per
-- alliance, and a player who moved between our alliances lands in one.
--
-- One captured_at per roster batch (CLAUDE.md): alliance_roster_latest takes
-- the rows sharing the newest instant, so each batch below is one insert.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- Fixtures ------------------------------------------------------------------

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000f1001', 580, 'ext-dt-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000f1002', 581, 'ext-dt-b', 'Bravo', 'BBB');

delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000f1001",
                                           "00000000-0000-4000-8000-0000000f1002"]}');

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-0000000f3001', 580, 9230000000000001, 'dt only alpha', 90, 30),
  ('00000000-0000-4000-8000-0000000f3002', 581, 9230000000000002, 'dt only bravo', 80, 29),
  ('00000000-0000-4000-8000-0000000f3003', 581, 9230000000000003, 'dt moved', 70, 28);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000f0c01', 'dt probe');

-- Alpha's newest batch still lists the member who has since moved to Bravo;
-- Bravo's, an hour newer, lists them too. That is the real state of the
-- tables between the move and Alpha's next capture.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted)
select '00000000-0000-4000-8000-0000000f0b01', 'al.rank', 'test',
       'test:105:alpha:' || v.game_uid, now() - interval '2 hours',
       '00000000-0000-4000-8000-0000000f0c01', 580,
       '00000000-0000-4000-8000-0000000f1001', 580, v.player_id,
       v.game_uid, v.name, 2, 30, 100, false
from (values
    ('00000000-0000-4000-8000-0000000f3001'::uuid, 9230000000000001::bigint, 'dt only alpha'),
    ('00000000-0000-4000-8000-0000000f3003'::uuid, 9230000000000003::bigint, 'dt moved')
  ) as v(player_id, game_uid, name);

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted)
select '00000000-0000-4000-8000-0000000f0b02', 'al.rank', 'test',
       'test:105:bravo:' || v.game_uid, now() - interval '1 hour',
       '00000000-0000-4000-8000-0000000f0c01', 581,
       '00000000-0000-4000-8000-0000000f1002', 581, v.player_id,
       v.game_uid, v.name, 2, 30, 100, false
from (values
    ('00000000-0000-4000-8000-0000000f3002'::uuid, 9230000000000002::bigint, 'dt only bravo'),
    ('00000000-0000-4000-8000-0000000f3003'::uuid, 9230000000000003::bigint, 'dt moved')
  ) as v(player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000f2001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dt-member-a@test.invalid'),
  ('00000000-0000-4000-8000-0000000f2002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dt-officer-b@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000f2001', 'member'),   -- mirror: Alpha
  ('00000000-0000-4000-8000-0000000f2002', 'viewer');
insert into public.alliance_memberships (user_id, alliance_id, role)
values ('00000000-0000-4000-8000-0000000f2002', '00000000-0000-4000-8000-0000000f1002', 'officer');
update public.role_permissions set allowed = true
where role = 'officer' and capability = 'data.enter';

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true),
         set_config('request.headers', '{}', true);
$$;

-- The roster cache ----------------------------------------------------------

-- 1-3. Both batches landed; the cache holds each player once, in the alliance
-- of the newest batch that lists them.
select is(
  (select alliance_id from public.member_roster_current
    where player_id = '00000000-0000-4000-8000-0000000f3001'),
  '00000000-0000-4000-8000-0000000f1001'::uuid,
  'an Alpha-only member is cached as Alpha''s');
select is(
  (select alliance_id from public.member_roster_current
    where player_id = '00000000-0000-4000-8000-0000000f3002'),
  '00000000-0000-4000-8000-0000000f1002'::uuid,
  'a Bravo-only member is cached as Bravo''s — 0156 cached only the newest alliance');
select is(
  (select alliance_id from public.member_roster_current
    where player_id = '00000000-0000-4000-8000-0000000f3003'),
  '00000000-0000-4000-8000-0000000f1002'::uuid,
  'a member in both newest batches is cached once, under the newer');

-- 4-5. And each alliance's members read their own roster.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000f2001');
select is(
  (select array_agg(p.current_name order by p.current_name)
     from public.member_roster_current r join public.players p using (player_id)
    where p.current_name like 'dt %'),
  array['dt only alpha'],
  'a member of Alpha reads Alpha''s roster');
select pg_temp.as_user('00000000-0000-4000-8000-0000000f2002');
select is(
  (select array_agg(p.current_name order by p.current_name)
     from public.member_roster_current r join public.players p using (player_id)
    where p.current_name like 'dt %'),
  array['dt moved', 'dt only bravo'],
  'an officer of Bravo reads Bravo''s');

-- The rank build ------------------------------------------------------------

-- 6-9. Built while viewing Bravo: Bravo's members, stamped Bravo, and nobody
-- in Alpha sees the rows.
select is(public.build_rank_period('2026-07-27T02:00:00Z'), 2,
  'building while viewing Bravo scores Bravo''s two members');
reset role;
select is(
  (select array_agg(distinct alliance_id::text) from public.rank_period_snapshots
    where period_start = '2026-07-27T02:00:00Z'
      and player_id::text like '00000000-0000-4000-8000-0000000f3%'),
  array['00000000-0000-4000-8000-0000000f1002'],
  'and stamps every row Bravo''s');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000f2001');
select is(
  (select count(*)::int from public.rank_period_snapshots
    where period_start = '2026-07-27T02:00:00Z'
      and player_id::text like '00000000-0000-4000-8000-0000000f3%'),
  0,
  'a member of Alpha does not see Bravo''s scores');
select pg_temp.as_user('00000000-0000-4000-8000-0000000f2002');
select is(
  (select count(*)::int from public.rank_period_snapshots
    where period_start = '2026-07-27T02:00:00Z'
      and player_id::text like '00000000-0000-4000-8000-0000000f3%'),
  2,
  'an officer of Bravo does');

-- 10. The announcement has one Discord channel, so only the primary uses it.
select like(public.announce_rank_period(), '%per-alliance Discord routing%',
  'Bravo''s rank announcement waits for per-alliance routing');

-- Entering the roster by hand ---------------------------------------------------

-- 11. Bravo's officer edits Bravo's roster; Alpha's newest batch is untouched.
-- (It used to refuse outright once two alliances were ours.)
select is(
  public.set_roster_membership('00000000-0000-4000-8000-0000000f3002', false), 1,
  'removing a member writes Bravo''s roster forward with one left');
reset role;
select is(
  (select count(*)::int from public.alliance_member_snapshots
    where alliance_id = '00000000-0000-4000-8000-0000000f1001'
      and captured_at = (select max(captured_at) from public.alliance_member_snapshots
                          where alliance_id = '00000000-0000-4000-8000-0000000f1001')),
  2,
  'and Alpha''s newest batch still has its two');

-- The hive board ------------------------------------------------------------

-- 13. "Still a member" asks the formation's alliance, not any own alliance.
-- Bravo's newest batch (after the removal above) holds only the moved member;
-- an Alpha-only member placed on Bravo's plan is in an own alliance's roster,
-- just not this plan's.
select set_config('request.jwt.claims', '{}', true);
insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y, alliance_id)
values ('00000000-0000-4000-8000-0000000f4002', 'dt bravo plan', 581, 500, 500,
        '00000000-0000-4000-8000-0000000f1002');
insert into public.hive_formation_slots (formation_id, dx, dy, player_id)
values ('00000000-0000-4000-8000-0000000f4002', 0, 0, '00000000-0000-4000-8000-0000000f3001');
select is(
  (select still_a_member from public.hive_formation_board
    where formation_id = '00000000-0000-4000-8000-0000000f4002'),
  false,
  'an Alpha member on Bravo''s plan is not "still a member" — 0174 said yes for any own alliance');

select * from finish();
rollback;
