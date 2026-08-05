-- 0073: the series views, and who may read them.
--
-- Two of the four are plain projections over `public_read` tables and need no
-- gate. The third, `alliance_roster_history`, is DEFINER over a table 0066
-- restricted to officers, so §20.2 applies: there is a negative test proving an
-- outsider gets nothing, and a positive one proving a member still gets rows —
-- because 0055's lesson is that a view refusing everybody is indistinguishable
-- from a working one until somebody looks.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc73', 'series test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad073', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'series-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000be073', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'series-member@test.invalid'),
  -- Signed in and carrying no app_users row at all, which is what a stranger
  -- who found the URL looks like.
  ('00000000-0000-4000-8000-0000000ce073', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'series-nobody@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad073', 'admin'),
  ('00000000-0000-4000-8000-0000000be073', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- One alliance, two ranking captures a week apart: power up, rank improved.
insert into public.alliances (alliance_id, server_id, external_id, current_name, member_count)
values ('00000000-0000-4000-8000-0000000ab073', 580, 'ext-series', 'SeriesTest', 2);

create function pg_temp.board(power bigint, rnk int, at timestamptz)
returns void language sql as $$
  insert into public.alliance_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, external_id,
    name, power, member_count, rank)
  values (gen_random_uuid(), 'server.rank', 'test', 'series:' || power || ':' || at,
    at, '00000000-0000-4000-8000-00000000cc73', 580,
    '00000000-0000-4000-8000-0000000ab073', 580, 'ext-series', 'SeriesTest',
    power, 2, rnk);
$$;

select pg_temp.board(1000, 9, '2026-07-28T05:00:00Z');
select pg_temp.board(1500, 6, '2026-08-04T05:00:00Z');

-- Two members in one complete roster batch, and one batch that was cut short.
create function pg_temp.roster(uid bigint, power bigint, hq int, rank int, at timestamptz)
returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid,
    member_rank, power, hq_level, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'seriesr:' || uid || ':' || at,
    at, '00000000-0000-4000-8000-00000000cc73', 580,
    '00000000-0000-4000-8000-0000000ab073', 580, uid, rank, power, hq, false);
$$;

select pg_temp.roster(9300000000000001, 100, 35, 2, '2026-08-04T05:00:00Z');
select pg_temp.roster(9300000000000002, 300, 31, 4, '2026-08-04T05:00:00Z');
-- One row for an alliance the game says has two: a half-scrolled capture.
select pg_temp.roster(9300000000000001, 120, 35, 2, '2026-08-05T05:00:00Z');

-- An alliance seen exactly once, for the unmeasured-is-not-flat assertion at the
-- bottom. Inserted here with the rest of the fixture rather than beside its
-- assertion: `authenticated` cannot write to `alliances`, so putting it down
-- there fails on the INSERT and reports as the assertion failing.
insert into public.alliances (alliance_id, server_id, external_id, current_name)
values ('00000000-0000-4000-8000-0000000ac073', 580, 'ext-once', 'SeenOnce');
insert into public.alliance_snapshots (
  observation_id, source_command, parser_version, idempotency_key, captured_at,
  collector_id, collected_from_server_id, alliance_id, server_id, external_id,
  name, power, rank)
values (gen_random_uuid(), 'server.rank', 'test', 'series:once', '2026-08-04T05:00:00Z',
  '00000000-0000-4000-8000-00000000cc73', 580,
  '00000000-0000-4000-8000-0000000ac073', 580, 'ext-once', 'SeenOnce', 777, 40);

set local role authenticated;

-- ---------------------------------------------------------------- the outsider
-- FIRST, before any positive assertion. A test file that proves the happy path
-- and then checks the gate tends to grow a positive-only habit.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce073');
select is(
  (select count(*) from public.alliance_roster_history
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'),
  0::bigint,
  'somebody with no app_users row reads no roster history at all');

-- And the table underneath stays shut to them, so the view is a narrower window
-- onto 0066 rather than a way around it.
--
-- Zero rows, not 42501: `authenticated` holds the grant, so what stops them is
-- 0066's policy and a policy filters rather than raises. Asserting the error
-- code here was wrong and passed for no one — worth writing down, because the
-- difference decides what a client sees when it gets this wrong.
select is(
  (select count(*) from public.alliance_member_snapshots
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'),
  0::bigint,
  'and the table underneath yields them nothing either');

-- ------------------------------------------------------------------ the member
select pg_temp.act_as('00000000-0000-4000-8000-0000000be073');

-- The positive half of §20.2. A gate that refuses everybody passes every
-- negative test ever written; this is the assertion 0055 wished it had.
select is(
  (select observed_members from public.alliance_roster_history
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'
      and captured_at = '2026-08-04T05:00:00Z'),
  2::bigint,
  'an ordinary member reads the complete batch');

select is(
  (select avg_hq_level from public.alliance_roster_history
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'
      and captured_at = '2026-08-04T05:00:00Z'),
  33.00::numeric,
  'and the tower-level average, which is the point of the view');

select is(
  (select members_at_hq35 from public.alliance_roster_history
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'
      and captured_at = '2026-08-04T05:00:00Z'),
  1::bigint,
  'counted at the cap rather than only averaged');

-- The trap 0067 documented, repeated here because a chart is where it bites:
-- one row for a two-member alliance is a capture that stopped early, and
-- averaging it beside a whole batch puts a step in the line that nothing in the
-- alliance caused.
select is(
  (select snapshot_complete from public.alliance_roster_history
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'
      and captured_at = '2026-08-05T05:00:00Z'),
  false,
  'a batch short of the game''s own count is flagged, not dropped');

-- ------------------------------------------------------------------- the growth
select is(
  (select power_growth from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'),
  500::bigint,
  'growth is last minus first');

select is(
  (select power_growth_pct from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'),
  50.00::numeric,
  'and the percentage of where they started');

-- Signed so that positive means climbing. Rank 9 to rank 6 is an improvement,
-- and a view whose sign says otherwise gets read exactly once before somebody
-- promotes the wrong answer.
select is(
  (select rank_climb from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'),
  3,
  'rank_climb is positive for an alliance that moved up the board');

select is(
  (select round(span_days::numeric, 1) from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000ab073'),
  7.0::numeric,
  'over the span the two readings were actually taken, not an assumed week');

-- One reading is unmeasured, not flat. Zero here would put an alliance nobody
-- has looked at twice next to one that genuinely has not moved.
select is(
  (select power_growth from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000ac073'),
  null,
  'an alliance seen once has null growth, and is still listed');

reset role;

select * from finish();
rollback;
