-- 0050: the two-week grid, against the same vectors the dashboard is checked
-- with (protocol-fixtures/rank-period/vectors.json). Two implementations
-- reading one file is what has kept the game week rule honest since 0001,
-- and a period is that rule taken every other time.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- The vectors, inlined the same way 04_reset_week_test does — keep in sync
-- with the fixture by hand until something checks it automatically.
-- Epoch 2026-08-03 since 0071. It was 07-27, taken from arena's own reported
-- week_start; arena weeks start on Monday too, so both are real boundaries and
-- the move is a change of PHASE, not of rule. Every expectation below shifted
-- by a week because of it — which is the cost of the phase change and the
-- reason the fixture, the SQL and the TypeScript move in one commit.
select is(public.rank_period_start('2026-08-03T02:00:00Z'), '2026-08-03T02:00:00Z'::timestamptz,
  'the epoch is its own period start');
select is(public.rank_period_start('2026-08-03T01:59:59Z'), '2026-07-20T02:00:00Z'::timestamptz,
  'one second before the epoch falls in the previous period');
select is(public.rank_period_start('2026-08-10T02:00:00Z'), '2026-08-03T02:00:00Z'::timestamptz,
  'the odd week in between belongs to the period that started before it');
select is(public.rank_period_start('2026-08-17T01:59:59Z'), '2026-08-03T02:00:00Z'::timestamptz,
  'and so does the last moment of it');
select is(public.rank_period_start('2026-08-17T02:00:00Z'), '2026-08-17T02:00:00Z'::timestamptz,
  'two weeks on is the next period');
select is(public.rank_period_start('2026-08-05T13:45:12Z'), '2026-08-03T02:00:00Z'::timestamptz,
  'midweek lands on the period it is inside');
select is(public.rank_period_start('2026-07-27T02:00:00Z'), '2026-07-20T02:00:00Z'::timestamptz,
  'the previous anchor is now mid-period, which is what the phase change means');
select is(public.rank_period_start('2026-01-05T02:00:00Z'), '2026-01-05T02:00:00Z'::timestamptz,
  'well before the epoch still resolves, on the same fortnightly grid');

-- The measurement points. 01:59, not 02:00: a minute later the game has
-- wiped the weekly boards and everybody scores zero.
select is(public.rank_period_week_ends('2026-08-03T02:00:00Z'),
  array['2026-08-10T01:59:00Z'::timestamptz, '2026-08-17T01:59:00Z'::timestamptz],
  'the weekly readings land a minute before the boards clear');

select is(public.rank_period_start((public.rank_period_week_ends('2026-08-03T02:00:00Z'))[1]),
  '2026-08-03T02:00:00Z'::timestamptz,
  'and the first one is inside the period it belongs to');
select is(public.rank_period_start((public.rank_period_week_ends('2026-08-03T02:00:00Z'))[2]),
  '2026-08-03T02:00:00Z'::timestamptz,
  'as is the second, which a reading at 02:00 would not be');

-- Derived from the week rule rather than reimplementing it, so the two
-- cannot disagree about what a Monday is.
select is(public.rank_period_start('2026-08-05T13:45:12Z'),
  public.reset_week_start(public.rank_period_start('2026-08-05T13:45:12Z')),
  'every period start is itself a game week start');

select * from finish();
rollback;
