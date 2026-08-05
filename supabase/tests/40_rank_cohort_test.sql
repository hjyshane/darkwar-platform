-- 0071: who is in the pool being compared, and who gets no tier at all.
--
-- Percentiles are relative, so the cohort decides everybody's answer. Two
-- groups are out: R4 and above, who are not competing for a promotion and whose
-- totals drag everyone else down a rank; and members whose join we actually
-- witnessed inside the last fortnight, who cannot have a fortnight's
-- contribution.
--
-- Both still get a ROW. Dropping them from the output would leave an officer
-- hunting for a name that is simply absent, which is worse than a row saying
-- why there is no grade.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc71', 'cohort test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-00000000ac71', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'cohort@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-00000000ac71', 'admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Only ours, so the seed's own alliance cannot join the pool.
update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000cb001', 580, 'ext-cohort', 'CohortTest', true);

-- Four members: two ordinary, one officer, one who joined inside the window.
insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000cb101', 580, 9200000000000001, 'Worker',
   '00000000-0000-4000-8000-0000000cb001'),
  ('00000000-0000-4000-8000-0000000cb102', 580, 9200000000000002, 'Slacker',
   '00000000-0000-4000-8000-0000000cb001'),
  ('00000000-0000-4000-8000-0000000cb103', 580, 9200000000000003, 'Officer',
   '00000000-0000-4000-8000-0000000cb001'),
  ('00000000-0000-4000-8000-0000000cb104', 580, 9200000000000004, 'Newcomer',
   '00000000-0000-4000-8000-0000000cb001');

create function pg_temp.roster(uid bigint, pid uuid, rank int, at timestamptz)
returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id,
    member_rank, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'cohort:' || uid || ':' || at,
    at, '00000000-0000-4000-8000-00000000cc71', 580,
    '00000000-0000-4000-8000-0000000cb001', 580, uid, pid, rank, false);
$$;

-- The roster was first captured well before the period. Three of the four were
-- in it then; Newcomer turns up much later, which is a join we witnessed.
select pg_temp.roster(9200000000000001, '00000000-0000-4000-8000-0000000cb101', 2,
  '2026-06-01T02:00:00Z');
select pg_temp.roster(9200000000000002, '00000000-0000-4000-8000-0000000cb102', 2,
  '2026-06-01T02:00:00Z');
select pg_temp.roster(9200000000000003, '00000000-0000-4000-8000-0000000cb103', 4,
  '2026-06-01T02:00:00Z');
select pg_temp.roster(9200000000000004, '00000000-0000-4000-8000-0000000cb104', 2,
  '2026-08-04T02:00:00Z');

create function pg_temp.contribute(uid bigint, amount bigint, at timestamptz)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, game_uid,
    contribution_type, score)
  values (gen_random_uuid(), 'get.week.alliance.donate.rank', 'test',
    'cohortc:' || uid || ':' || at, at,
    '00000000-0000-4000-8000-00000000cc71', 580, 580, uid, 'weekly_donation', amount);
$$;

-- Period 2026-08-03 to 08-17; weekly readings at 08-10 01:59 and 08-17 01:59.
-- The officer gives the most, which is exactly the row that used to bend
-- everybody else's percentile.
select pg_temp.contribute(9200000000000001, 1000, '2026-08-10T01:00:00Z');
select pg_temp.contribute(9200000000000002, 10, '2026-08-10T01:00:00Z');
select pg_temp.contribute(9200000000000003, 999999, '2026-08-10T01:00:00Z');
select pg_temp.contribute(9200000000000004, 500, '2026-08-10T01:00:00Z');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000ac71');
select lives_ok(
  $$ select public.build_rank_period('2026-08-03T02:00:00Z') $$,
  'the period builds');

create function pg_temp.row_of(who text) returns public.rank_period_snapshots
language sql as $$
  select * from public.rank_period_snapshots
  where period_start = '2026-08-03T02:00:00Z' and name = who and scoring_version = 2;
$$;

-- Everybody gets a row, graded or not. Scoped to these four names: 0031's
-- trigger re-derives is_own from `presence_redacted` across ALL alliances on
-- insert, so adding an unredacted roster row here also re-flags the seed's
-- alliance and its 20 members join the output. Counting the whole period read
-- 24 and told me nothing about my own fixture.
select is((select count(*) from public.rank_period_snapshots
           where period_start = '2026-08-03T02:00:00Z' and scoring_version = 2
             and name in ('Worker', 'Slacker', 'Officer', 'Newcomer')),
  4::bigint, 'all four members are in the output');

-- The officer.
select is((pg_temp.row_of('Officer')).tier, null, 'an R4 gets no tier');
select is((pg_temp.row_of('Officer')).tier_reason, 'not graded: R4 and above',
  'and the row says why');
select is((pg_temp.row_of('Officer')).activity_score, null,
  'and no activity score, so nothing to sort them by');

-- The newcomer.
select is((pg_temp.row_of('Newcomer')).tier, null,
  'somebody we watched join this fortnight gets no tier');
select is((pg_temp.row_of('Newcomer')).tier_reason,
  'not graded: joined within the last two weeks', 'and the row says why');

-- The two who are competing. THE POINT: the officer gave 999999 and is out of
-- the pool, so nobody's percentile is measured against it.
--
-- Asserted as a relation rather than as 100 and 0, because the seed's alliance
-- joins the pool through the trigger described above and its members sit
-- between these two. What must hold regardless of who else is in the pool is
-- that the officer is not, and that giving more ranks higher.
select ok(
  (pg_temp.row_of('Worker')).donation_pct > (pg_temp.row_of('Slacker')).donation_pct,
  'giving more ranks higher inside the graded pool');
select ok(
  (pg_temp.row_of('Worker')).donation_pct >= all (
    select coalesce(donation_pct, -1) from public.rank_period_snapshots
    where period_start = '2026-08-03T02:00:00Z' and scoring_version = 2
  ),
  'and the officer''s 999999 tops nobody, because it was never in the pool');
reset role;

select * from finish();
rollback;
