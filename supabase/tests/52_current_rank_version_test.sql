-- 0089: the current rank is the newest version, not whichever row the scan met
-- first.
--
-- The bug this pins was invisible in a small fixture and obvious in production:
-- `distinct on (player_id) ... order by player_id, period_start desc` has no
-- tie-break, and a period holds one row per scoring version. 59 of 95 members
-- were showing a tier from an older version than the one that existed for them.
--
-- A test that inserted one version per period would have passed the whole time,
-- so every case below puts TWO versions in the same period and asserts which one
-- comes out.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000c1089', 580, 9900000000000891, 'Rebuilt'),
  ('00000000-0000-4000-8000-0000000c2089', 580, 9900000000000892, 'OlderPeriod'),
  ('00000000-0000-4000-8000-0000000c3089', 580, 9900000000000893, 'HandSetOnly');

create function pg_temp.snap(
  player uuid, period text, version int, tier text, score numeric)
returns void language sql as $$
  insert into public.rank_period_snapshots
    (player_id, game_uid, name, period_start, scoring_version, tier, tier_reason,
     activity_score)
  values (player,
    (select game_uid from public.players where player_id = player),
    (select current_name from public.players where player_id = player),
    period::timestamptz, version, tier, 'score', score);
$$;

-- The case that was broken. One period, three versions, and the versions
-- DISAGREE about the tier — which is the point, since a rebuild that changed
-- nothing would hide the bug.
select pg_temp.snap('00000000-0000-4000-8000-0000000c1089', '2026-08-03', 2, 'R1', 9.1);
select pg_temp.snap('00000000-0000-4000-8000-0000000c1089', '2026-08-03', 3, 'R2', 41.9);
select pg_temp.snap('00000000-0000-4000-8000-0000000c1089', '2026-08-03', 4, 'R3', 74.8);

-- An older period at a HIGHER version than the newest period carries. The period
-- has to win first, or a stale rebuild of an old fortnight would outrank this
-- fortnight's answer.
select pg_temp.snap('00000000-0000-4000-8000-0000000c2089', '2026-07-20', 4, 'R3', 80.0);
select pg_temp.snap('00000000-0000-4000-8000-0000000c2089', '2026-08-03', 2, 'R1', 5.0);
select pg_temp.snap('00000000-0000-4000-8000-0000000c2089', '2026-08-03', 3, 'R2', 30.0);

-- A hand-set rank with no period at all. The full join is what keeps them on the
-- roster; a plain join off the snapshots would drop them.
insert into public.player_ranks (player_id, assigned_rank)
values ('00000000-0000-4000-8000-0000000c3089', 'R4');

select is(
  (select computed_tier from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c1089'),
  'R3',
  'the newest scoring version in the newest period is what shows');

select is(
  (select rank_score from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c1089'),
  74.8::numeric,
  'and the score comes from that same row, not a different version');

select is(
  (select period_start::date from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c1089'),
  '2026-08-03'::date,
  'the period is the newest one');

select is(
  (select computed_tier from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c2089'),
  'R2',
  'a newer period at a lower version still beats an older period at a higher one');

select is(
  (select period_start::date from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c2089'),
  '2026-08-03'::date,
  'the period is chosen before the version, not after');

select is(
  (select assigned_rank from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c3089'),
  'R4',
  'a hand-set rank with no period is still on the roster');

select is(
  (select computed_tier from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c3089'),
  NULL::text,
  'and has no computed tier rather than a borrowed one');

-- One row per member, whatever the snapshots hold. `distinct on` promises this
-- and the join could break it.
select is(
  (select count(*) from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c1089'),
  1::bigint,
  'three versions still make one row');

select * from finish();
rollback;
