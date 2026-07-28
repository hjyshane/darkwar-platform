-- Monday 02:00 UTC week boundary. These vectors are the SQL copy of
-- protocol-fixtures/reset-week/vectors.json, which the Python and
-- TypeScript implementations also consume — change them together.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select is(public.reset_week_start('2026-07-27T02:00:00Z'::timestamptz),
  '2026-07-27T02:00:00Z'::timestamptz,
  'exact boundary is its own week start');

select is(public.reset_week_start('2026-07-27T01:59:59Z'::timestamptz),
  '2026-07-20T02:00:00Z'::timestamptz,
  'one second before boundary belongs to previous week');

select is(public.reset_week_start('2026-07-28T12:34:56Z'::timestamptz),
  '2026-07-27T02:00:00Z'::timestamptz,
  'midweek');

select is(public.reset_week_start('2026-08-02T23:59:59Z'::timestamptz),
  '2026-07-27T02:00:00Z'::timestamptz,
  'sunday end of week');

select is(public.reset_week_start('2026-01-01T00:30:00Z'::timestamptz),
  '2025-12-29T02:00:00Z'::timestamptz,
  'year boundary');

select is(public.reset_week_start('2026-12-28T01:00:00Z'::timestamptz),
  '2026-12-21T02:00:00Z'::timestamptz,
  'monday before 02:00 near year end');

select is(public.reset_week_start('2026-07-27T11:00:00+09:00'::timestamptz),
  '2026-07-27T02:00:00Z'::timestamptz,
  'non-UTC offset input normalizes to UTC');

select * from finish();
rollback;
