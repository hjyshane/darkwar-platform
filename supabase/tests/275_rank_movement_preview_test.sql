-- 0275: the preview reads the fortnight in progress, and only that one.
--
-- Mirror of 78_movement_waits_test.sql. The finished view must keep refusing
-- the running period; the preview must take exactly it, and be closed to anon.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000ce75', 'preview test', 'offline', 'test')
on conflict do nothing;

insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000fd275', 580, 9800000000000275, 'Previewer');

create function pg_temp.period(at timestamptz, tier text, score numeric)
returns void language sql as $$
  insert into public.rank_period_snapshots (
    period_start, player_id, game_uid, name, activity_score, tier, scoring_version)
  values (at, '00000000-0000-4000-8000-0000000fd275', 9800000000000275, 'Previewer',
    score, tier, 4);
$$;

select pg_temp.period(now() - interval '4 weeks', 'R3', 80);
select pg_temp.period(now() - interval '2 weeks' - interval '1 hour', 'R2', 50);
select pg_temp.period(now() - interval '1 week', 'R1', 17);

select is(
  (select period_start from public.rank_period_movement_preview),
  (now() - interval '1 week')::timestamptz,
  'the preview reports the fortnight still running');

select is(
  (select previous_period_start from public.rank_period_movement_preview),
  (now() - interval '2 weeks' - interval '1 hour')::timestamptz,
  'compared against the most recent earlier period');

select is(
  (select tier_change from public.rank_period_movement_preview),
  -1,
  'R2 to R1 reads as a slip of one');

select is(
  (select period_start from public.rank_period_movement),
  (now() - interval '2 weeks' - interval '1 hour')::timestamptz,
  'and the finished-only view still refuses the running period (0132)');

set local role anon;
select throws_ok($$ select * from public.rank_period_movement_preview $$, '42501',
  null, 'anon cannot read the preview');

select * from finish();
rollback;
