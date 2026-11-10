-- 0316: a rank period set by hand, and the fortnights around it.
--
-- Three things are pinned. The RULE: a hand-set period wins where it covers
-- the instant, the fortnightly grid re-anchors at its end, and the fortnight
-- running up to it is cut short. The GATE: settings.write writes, a member
-- cannot, and another alliance's periods are invisible. The SCORER: a period
-- of one or two weeks builds with as many readings as it has weeks, records
-- its own end, and the movement views judge "finished" by that end rather than
-- by two weeks assumed.
--
-- Fixed dates for the rule, on an alliance nothing else touches; everything
-- that has to agree with now() is anchored to the reset of the current week.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-0000000cc315', 'period test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad315', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'period-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000be315', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'period-member@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad315', 'admin'),
  ('00000000-0000-4000-8000-0000000be315', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- One own alliance, by rule rather than by row order (see 89's note).
update public.alliances set is_own = false, roster_unredacted_seen = false
where is_own or roster_unredacted_seen;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own) values
  ('00000000-0000-4000-8000-0000000ab315', 580, 'ext-period-a', 'PeriodA', true),
  ('00000000-0000-4000-8000-0000000bb315', 581, 'ext-period-b', 'PeriodB', false),
  ('00000000-0000-4000-8000-0000000cb315', 582, 'ext-period-c', 'PeriodC', false);

-- The reset of the week now running: every now-relative date hangs off it.
create function pg_temp.w() returns timestamptz language sql stable as $$
  select public.reset_week_start(now());
$$;

-- A period as one line, in UTC, so the assertions read as dates.
create function pg_temp.b(moment timestamptz, who uuid) returns text language sql stable as $$
  select to_char(period_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
    || ' -> ' || to_char(period_end at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
    || case when overridden then ' (set)' else '' end
  from public.rank_period_bounds(moment, who);
$$;

-- ---------------------------------------------------------------- the rule
-- Alliance B: a fortnight set by hand off the grid's phase, then a three-week
-- period two months later. Written as the owner; the gate is tested below.
insert into public.rank_period_overrides (alliance_id, period_start, period_end, note) values
  ('00000000-0000-4000-8000-0000000bb315', '2026-11-16 02:00+00', '2026-11-30 02:00+00', 'season'),
  ('00000000-0000-4000-8000-0000000bb315', '2027-01-11 02:00+00', '2027-02-01 02:00+00', 'migration');

select is(pg_temp.b('2026-11-03 12:00+00', '00000000-0000-4000-8000-0000000bb315'),
  '2026-10-26 02:00 -> 2026-11-09 02:00',
  'before any hand-set period the grid answers as it always has');
select is(pg_temp.b('2026-11-10 12:00+00', '00000000-0000-4000-8000-0000000bb315'),
  '2026-11-09 02:00 -> 2026-11-16 02:00',
  'the fortnight running up to a hand-set period is cut short where it begins');
select is(pg_temp.b('2026-11-16 02:00+00', '00000000-0000-4000-8000-0000000bb315'),
  '2026-11-16 02:00 -> 2026-11-30 02:00 (set)',
  'the hand-set period''s own start belongs to it');
select is(pg_temp.b('2026-11-30 01:59:59+00', '00000000-0000-4000-8000-0000000bb315'),
  '2026-11-16 02:00 -> 2026-11-30 02:00 (set)',
  'and so does its last second');
select is(pg_temp.b('2026-11-30 02:00+00', '00000000-0000-4000-8000-0000000bb315'),
  '2026-11-30 02:00 -> 2026-12-14 02:00',
  'after it the fortnights count from its end — the grid would have said 11-23');
select is(pg_temp.b('2027-01-05 12:00+00', '00000000-0000-4000-8000-0000000bb315'),
  '2026-12-28 02:00 -> 2027-01-11 02:00',
  'and keep counting from there until the next hand-set period');
select is(pg_temp.b('2027-01-20 12:00+00', '00000000-0000-4000-8000-0000000bb315'),
  '2027-01-11 02:00 -> 2027-02-01 02:00 (set)',
  'a three-week period is three weeks');
select is(pg_temp.b('2027-02-03 12:00+00', '00000000-0000-4000-8000-0000000bb315'),
  '2027-02-01 02:00 -> 2027-02-15 02:00',
  'and re-anchors the grid again at its end');
select is(pg_temp.b('2026-11-20 12:00+00', '00000000-0000-4000-8000-0000000cb315'),
  '2026-11-09 02:00 -> 2026-11-23 02:00',
  'an alliance with no hand-set periods is on the plain grid');
select is(pg_temp.b('2026-11-20 12:00+00', null),
  '2026-11-09 02:00 -> 2026-11-23 02:00',
  'and so is nobody — no alliance means no hand-set periods apply');

select is(public.rank_period_reading_ends('2026-11-16 02:00+00', '2026-11-30 02:00+00'),
  public.rank_period_week_ends('2026-11-16 02:00+00'),
  'a fortnight''s readings are the two 0309 always gave');
select is(public.rank_period_reading_ends('2026-11-09 02:00+00', '2026-11-16 02:00+00'),
  array['2026-11-15 14:00+00'::timestamptz],
  'a one-week period has one reading, Sunday 14:00Z');
select is(cardinality(public.rank_period_reading_ends('2026-11-16 02:00+00', '2026-12-14 02:00+00')),
  4, 'a four-week period has four');

-- ---------------------------------------------------------------- the gate
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad315');

select throws_ok(
  $$ select public.save_rank_period_override('2026-11-17 02:00+00', '2026-11-30 02:00+00') $$,
  '22023', null, 'a start that is not Monday 02:00 UTC is refused, in words');
select throws_ok(
  $$ select public.save_rank_period_override('2026-12-07 02:00+00', '2026-12-07 02:00+00') $$,
  '22023', null, 'a period has to end after it starts');
select throws_ok(
  $$ select public.save_rank_period_override('2026-12-07 02:00+00', '2027-01-11 02:00+00') $$,
  '22023', null, 'and five weeks is too long');

-- The alliance being viewed (A): a fortnight starting a week before this
-- week's reset, so now() is inside it, with a one-week period either side.
select lives_ok(
  $$ select public.save_rank_period_override(pg_temp.w() - interval '7 days',
       pg_temp.w() + interval '7 days', ' this week  ') $$,
  'an admin sets the period now running');
select throws_ok(
  $$ select public.save_rank_period_override(pg_temp.w(), pg_temp.w() + interval '14 days') $$,
  '23505', null, 'a period overlapping one already set is refused');
select lives_ok(
  $$ select public.save_rank_period_override(pg_temp.w() + interval '7 days',
       pg_temp.w() + interval '14 days') $$,
  'one that starts exactly where another ends is not an overlap');
select lives_ok(
  $$ select public.save_rank_period_override(pg_temp.w() - interval '14 days',
       pg_temp.w() - interval '7 days') $$,
  'nor one that ends exactly where another starts');
select is(
  (select count(*) from public.rank_period_overrides
    where alliance_id = '00000000-0000-4000-8000-0000000ab315'),
  3::bigint, 'three periods set for the alliance being viewed');
select is(
  (select note from public.rank_period_overrides
    where alliance_id = '00000000-0000-4000-8000-0000000ab315'
      and period_start = pg_temp.w() - interval '7 days'),
  'this week', 'the note is kept trimmed');
select is(
  (select count(*) from public.rank_period_overrides
    where alliance_id = '00000000-0000-4000-8000-0000000bb315'),
  0::bigint, 'another alliance''s hand-set periods are not visible from this one');
select throws_ok(
  $$ select public.delete_rank_period_override('00000000-0000-4000-8000-0000000dd315') $$,
  'P0002', null, 'removing a period that is not there says so');

select pg_temp.act_as('00000000-0000-4000-8000-0000000be315');
select throws_ok(
  $$ select public.save_rank_period_override(pg_temp.w() + interval '14 days',
       pg_temp.w() + interval '21 days') $$,
  '42501', null, 'a member cannot set a period');
select throws_ok(
  $$ insert into public.rank_period_overrides (alliance_id, period_start, period_end)
     values ('00000000-0000-4000-8000-0000000ab315',
             pg_temp.w() + interval '14 days', pg_temp.w() + interval '21 days') $$,
  '42501', null, 'nor write the table behind the function');
select is(
  (select count(*) from public.rank_period_overrides),
  3::bigint, 'but reads the ones set for the alliance');
reset role;

select is(
  (select count(*) from public.rank_period_overrides
    where alliance_id = '00000000-0000-4000-8000-0000000bb315'),
  2::bigint, 'the owner sees the other alliance''s two, so the zero above was the policy');

-- ---------------------------------------------------------------- the scorer
insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id) values
  ('00000000-0000-4000-8000-000000cb3151', 580, 9315000000000001, 'Both',
   '00000000-0000-4000-8000-0000000ab315'),
  ('00000000-0000-4000-8000-000000cb3152', 580, 9315000000000002, 'FirstOnly',
   '00000000-0000-4000-8000-0000000ab315');

create function pg_temp.roster(uid bigint, pid uuid) returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id,
    member_rank, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'p315r:' || uid,
    now() - interval '60 days', '00000000-0000-4000-8000-0000000cc315', 580,
    '00000000-0000-4000-8000-0000000ab315', 580, uid, pid, 2, false);
$$;
select pg_temp.roster(9315000000000001, '00000000-0000-4000-8000-000000cb3151');
select pg_temp.roster(9315000000000002, '00000000-0000-4000-8000-000000cb3152');

create function pg_temp.donate(uid bigint, score bigint, moment timestamptz)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, game_uid,
    contribution_type, score)
  values (gen_random_uuid(), 'al.rank.info', 'test',
    'p315c:' || uid || ':' || extract(epoch from moment)::bigint,
    moment, '00000000-0000-4000-8000-0000000cc315', 580, 580, uid, 'weekly_donation', score);
$$;
-- Week one of the period now running opens a week before this reset; week two
-- opens at the reset. One reading each for 'Both', one for 'FirstOnly'.
select pg_temp.donate(9315000000000001, 1000, pg_temp.w() - interval '6 days');
select pg_temp.donate(9315000000000001, 2000, pg_temp.w() + interval '1 hour');
select pg_temp.donate(9315000000000002, 300, pg_temp.w() - interval '6 days');

insert into public.app_settings (key, value)
values ('rank_tiers', jsonb_build_object(
  'r3_percent', 50, 'r2_percent', 50, 'offline_hours', 100000,
  'weights', jsonb_build_object('donation', 1, 'duel', 0, 'power_growth', 0)))
on conflict (key) do update set value = excluded.value;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad315');

select throws_ok(
  $$ select public.build_rank_period(pg_temp.w()) $$,
  '22023', null,
  'a date inside a hand-set period is not its start, and the build says so rather than guess an end');
select lives_ok(
  $$ select public.build_rank_period(pg_temp.w() - interval '7 days') $$,
  'the period now running builds from its own start');

select is(
  (select period_end from public.rank_period_latest
    where player_id = '00000000-0000-4000-8000-000000cb3151'
      and period_start = pg_temp.w() - interval '7 days'),
  pg_temp.w() + interval '7 days',
  'the snapshot records the period''s end, and the latest view shows the column');
select is(
  (select array[donation_week1, donation_week2, donation_total]::numeric[] from public.rank_period_latest
    where player_id = '00000000-0000-4000-8000-000000cb3151'
      and period_start = pg_temp.w() - interval '7 days'),
  array[1000, 2000, 3000]::numeric[],
  'two readings in a two-week period, summed');
select is(
  (select array[donation_week1, donation_week2, donation_total]::numeric[] from public.rank_period_latest
    where player_id = '00000000-0000-4000-8000-000000cb3152'
      and period_start = pg_temp.w() - interval '7 days'),
  array[300, null, 300]::numeric[],
  'an unread week is not a zero: the total is the week that was read');

select lives_ok(
  $$ select public.build_rank_period(pg_temp.w() - interval '14 days') $$,
  'the one-week period before it builds too');
select is(
  (select count(*) from public.rank_period_latest
    where period_start = pg_temp.w() - interval '14 days'
      and period_end = pg_temp.w() - interval '7 days'),
  2::bigint, 'with both members and a one-week end');

-- FINISHED MEANS ITS OWN END HAS PASSED. The one-week period ended at the
-- reset a week ago; two weeks assumed from its start would still be running.
select is(
  (select min(period_start) from public.rank_period_movement),
  pg_temp.w() - interval '14 days',
  'the members tab compares the one-week period, which has finished by its own end');
select is(
  (select min(period_start) from public.rank_period_movement_preview),
  pg_temp.w() - interval '7 days',
  'and the preview shows the one now running');

select is(
  (select array[period_start, period_end] from public.member_current_period_contribution
    where player_id = '00000000-0000-4000-8000-000000cb3151'),
  array[pg_temp.w() - interval '7 days', pg_temp.w() + interval '7 days'],
  'the running-period table is on the hand-set period');
select is(
  (select array[weeks, donation_week1, donation_week2, donation_total]::numeric[]
    from public.member_current_period_contribution
    where player_id = '00000000-0000-4000-8000-000000cb3151'),
  array[2, 1000, 2000, 3000]::numeric[],
  'with its week count and both readings');

-- What the report screen is offered: newest first, each ending where the one
-- after it begins, the hand-set ones marked.
select is(
  (select array[period_start, period_end] from public.recent_rank_periods(4) where in_progress),
  array[pg_temp.w() - interval '7 days', pg_temp.w() + interval '7 days'],
  'the first period offered is the hand-set one now running');
select is(
  (select array_agg(overridden order by period_start desc) from public.recent_rank_periods(4)),
  array[true, true, false, false],
  'the two hand-set periods are marked and the fortnights before them are not');
select is(
  (select bool_and(period_end = next_start) from (
     select period_end, lead(period_start) over (order by period_start) as next_start
     from public.recent_rank_periods(4)) x where next_start is not null),
  true, 'and each period ends exactly where the next begins');
reset role;

select * from finish();
rollback;
