-- 0087: which way is up.
--
-- The assertion this file exists for is the SIGN. R1 is the lowest tier and R3 the
-- highest — the activity score bands say so, cleanly separated: 9.1 mean for R1,
-- 41.9 for R2, 74.8 for R3 at 2026-08-03 v4. So R2 to R3 is a climb and
-- `tier_change` must be positive for it.
--
-- Backwards, this screen congratulates the members who slipped and has a word with
-- the ones who improved. Nothing about the output would look wrong.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- ------------------------------------------------------------------ the ordering
select is(public.tier_rank('R1'), 1, 'R1 is the lowest tier');
select is(public.tier_rank('R3'), 3, 'and R3 is above it');
select ok(public.tier_rank('R3') > public.tier_rank('R2'), 'R3 beats R2');
select ok(public.tier_rank('R2') > public.tier_rank('R1'), 'and R2 beats R1');

-- Not 0. A 0 sorts below R1 and would quietly make an unrecognised tier look like
-- the worst one rather than like a tier nobody has taught this function.
select is(public.tier_rank('R9'), NULL::int, 'an unknown tier has no rank at all');
select is(public.tier_rank(NULL), NULL::int, 'and neither does null');

-- --------------------------------------------------------------- the movement
insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000c1087', 580, 9900000000000871, 'Climber'),
  ('00000000-0000-4000-8000-0000000c2087', 580, 9900000000000872, 'Slipper'),
  ('00000000-0000-4000-8000-0000000c3087', 580, 9900000000000873, 'Steady'),
  ('00000000-0000-4000-8000-0000000c4087', 580, 9900000000000874, 'Officer'),
  ('00000000-0000-4000-8000-0000000c5087', 580, 9900000000000875, 'Newcomer');

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

-- The previous period, and then the newest. Two versions of the newest, so the
-- comparison has to pick the newer one — a rebuild supersedes, and comparing
-- against a superseded answer reports movement the rebuild caused (0071).
select pg_temp.snap('00000000-0000-4000-8000-0000000c1087', '2026-07-20T02:00:00Z', 4, 'R2', 40);
select pg_temp.snap('00000000-0000-4000-8000-0000000c2087', '2026-07-20T02:00:00Z', 4, 'R3', 80);
select pg_temp.snap('00000000-0000-4000-8000-0000000c3087', '2026-07-20T02:00:00Z', 4, 'R2', 45);
select pg_temp.snap('00000000-0000-4000-8000-0000000c4087', '2026-07-20T02:00:00Z', 4, NULL, 90);
-- Newcomer has no previous period at all.

select pg_temp.snap('00000000-0000-4000-8000-0000000c1087', '2026-08-03T02:00:00Z', 3, 'R1', 5);
select pg_temp.snap('00000000-0000-4000-8000-0000000c1087', '2026-08-03T02:00:00Z', 4, 'R3', 75);
select pg_temp.snap('00000000-0000-4000-8000-0000000c2087', '2026-08-03T02:00:00Z', 4, 'R2', 50);
select pg_temp.snap('00000000-0000-4000-8000-0000000c3087', '2026-08-03T02:00:00Z', 4, 'R2', 52);
select pg_temp.snap('00000000-0000-4000-8000-0000000c4087', '2026-08-03T02:00:00Z', 4, NULL, 95);
select pg_temp.snap('00000000-0000-4000-8000-0000000c5087', '2026-08-03T02:00:00Z', 4, 'R2', 44);

-- THE ONE THAT MATTERS. R2 to R3 is a climb, so the sign is positive.
select is(
  (select tier_change from public.rank_period_movement
    where player_id = '00000000-0000-4000-8000-0000000c1087'),
  1,
  'climbing from R2 to R3 is a POSITIVE tier_change');

select is(
  (select tier_change from public.rank_period_movement
    where player_id = '00000000-0000-4000-8000-0000000c2087'),
  -1,
  'and slipping from R3 to R2 is negative');

-- The rebuild rule: Climber has v3 (R1) and v4 (R3) for the newest period, and the
-- comparison must use v4. Against v3 this would read as a fall.
select is(
  (select tier from public.rank_period_movement
    where player_id = '00000000-0000-4000-8000-0000000c1087'),
  'R3',
  'the newest scoring version is the one compared, not a superseded rebuild');

-- An officer is measured and deliberately not ranked (0072), so there is nothing to
-- compare and no movement to report — rather than a change of zero, which would put
-- them in a "did not move" list they do not belong in.
select is(
  (select tier_change from public.rank_period_movement
    where player_id = '00000000-0000-4000-8000-0000000c4087'),
  NULL::int,
  'an untiered officer has no tier_change');

-- A first measurement is not a promotion. Newcomer has a tier now and had none
-- before, and announcing that as a climb would be a false claim about their
-- conduct — the same rule the Discord report applies.
select is(
  (select tier_change from public.rank_period_movement
    where player_id = '00000000-0000-4000-8000-0000000c5087'),
  NULL::int,
  'and neither does somebody measured for the first time');

-- The score delta, which is what "gained the most" is read off.
select is(
  (select score_change from public.rank_period_movement
    where player_id = '00000000-0000-4000-8000-0000000c1087'),
  35::numeric,
  'score_change is the newest score less the previous one');

reset role;
select * from finish();
rollback;
