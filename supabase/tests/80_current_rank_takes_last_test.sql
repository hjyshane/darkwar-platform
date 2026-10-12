-- 0281: the rank a member is shown as holding comes from the LAST period,
-- finished or not. This replaces 0134's test, which pinned the opposite.
--
-- Four things are pinned. The unfinished newest period wins (the whole point of
-- the change); a period that was never built cannot be chosen, so "newest"
-- means newest that EXISTS; the newest scoring version inside a period still
-- wins (0089, which this must not undo); and a hand-set rank shows with no
-- period at all, which breaks if the filter ever moves outside the subquery.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000fe001', 580, 9800000000000011, 'Latest'),
  ('00000000-0000-4000-8000-0000000fe002', 580, 9800000000000012, 'HandSet');

create function pg_temp.period(
  who uuid, uid bigint, at timestamptz, tier text, score numeric, version int default 4)
returns void language sql as $$
  insert into public.rank_period_snapshots (
    period_start, player_id, game_uid, name, activity_score, tier, scoring_version)
  values (at, who, uid, 'x', score, tier, version);
$$;

-- A finished fortnight, and one that opened an hour ago with a worse tier
-- because most readings are still empty.
select pg_temp.period('00000000-0000-4000-8000-0000000fe001', 9800000000000011,
  now() - interval '4 weeks', 'R3', 80);
select pg_temp.period('00000000-0000-4000-8000-0000000fe001', 9800000000000011,
  date_trunc('hour', now()) - interval '1 hour', 'R1', 17);

select is(
  (select computed_tier from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe001'),
  'R1',
  'the newest period decides the rank even though it has not finished');

select is(
  (select period_start from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe001'),
  date_trunc('hour', now()) - interval '1 hour',
  'and the view says which period that was');

-- Newest means newest that exists: with only the finished period built, it is
-- the answer. Remove the in-progress row to prove nothing else is invented.
delete from public.rank_period_snapshots
 where player_id = '00000000-0000-4000-8000-0000000fe001'
   and tier = 'R1';

select is(
  (select computed_tier from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe001'),
  'R3',
  'a fortnight nobody built is not chosen - the last built period stays in force');

-- 0089's pick: one period holds a row per scoring version, newest wins.
select pg_temp.period('00000000-0000-4000-8000-0000000fe001', 9800000000000011,
  date_trunc('hour', now()) - interval '1 hour', 'R1', 17, 4);
select pg_temp.period('00000000-0000-4000-8000-0000000fe001', 9800000000000011,
  date_trunc('hour', now()) - interval '1 hour', 'R2', 55, 5);

select is(
  (select computed_tier from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe001'),
  'R2',
  'within the period the newest scoring version still wins');

insert into public.player_ranks (player_id, assigned_rank)
values ('00000000-0000-4000-8000-0000000fe002', 'R4');

select is(
  (select assigned_rank from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe002'),
  'R4',
  'a hand-set rank shows with no period behind it');

select * from finish();
rollback;
