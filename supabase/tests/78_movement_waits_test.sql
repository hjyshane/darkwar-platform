-- 0132: an unfinished fortnight is not the headline.
--
-- The rank report screen defaults to the period in progress, so pressing Build
-- creates one that is measured part of the way through. Before this, the
-- Members tab made that the comparison on the front page — on production, a
-- fortnight two hours old with three of its four readings still empty.
--
-- The assertion is the wait, and the one below it is the reason the wait cannot
-- simply be "skip the newest": a finished period must still be reported the
-- moment it finishes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000ce77', 'movement test', 'offline', 'test')
on conflict do nothing;

insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000fd001', 580, 9800000000000001, 'Mover');

create function pg_temp.period(at timestamptz, tier text, score numeric)
returns void language sql as $$
  insert into public.rank_period_snapshots (
    period_start, player_id, game_uid, name, activity_score, tier, scoring_version)
  values (at, '00000000-0000-4000-8000-0000000fd001', 9800000000000001, 'Mover',
    score, tier, 4);
$$;

-- Two finished fortnights, and one that opened an hour ago.
select pg_temp.period(now() - interval '6 weeks', 'R1', 20);
select pg_temp.period(now() - interval '4 weeks', 'R3', 80);
select pg_temp.period(date_trunc('hour', now()) - interval '1 hour', 'R1', 17);

select is(
  (select period_start from public.rank_period_movement),
  (now() - interval '4 weeks')::timestamptz,
  'the newest FINISHED fortnight is the one reported, not the one that opened '
  'an hour ago with a quarter of its readings in');

select is(
  (select previous_period_start from public.rank_period_movement),
  (now() - interval '6 weeks')::timestamptz,
  'and it is compared against the finished one before it');

select is(
  (select tier_change from public.rank_period_movement),
  2,
  'R1 to R3 reads as a climb of two, so the wait did not change the arithmetic');

select * from finish();
rollback;
