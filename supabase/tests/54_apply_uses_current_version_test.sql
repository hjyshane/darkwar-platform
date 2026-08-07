-- 0091: a rebuild may only clear an override on the strength of its OWN answer.
--
-- The hole 0090 left: `build_rank_period` writes no row for a member it will not
-- grade, so in a period that still holds older rows, the newest row for that
-- member stays the OLD version's. 0090's guard read that stale tier and cleared a
-- rank the current formula never graded.
--
-- Every case below therefore mixes versions WITHIN one period, which is the only
-- shape where the two guards differ.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000c1091', 580, 9900000000000911, 'SkippedByV4'),
  ('00000000-0000-4000-8000-0000000c2091', 580, 9900000000000912, 'GradedByV4');

-- One member has only the OLD version's row, carrying a tier — exactly what v1
-- left behind for members it scored at zero and filed R1. The other was graded by
-- the current pass.
insert into public.rank_period_snapshots
  (player_id, game_uid, name, period_start, scoring_version, tier, tier_reason,
   activity_score)
values
  ('00000000-0000-4000-8000-0000000c1091', 9900000000000911, 'SkippedByV4',
   '2026-07-27'::timestamptz, 1, 'R1', 'offline', 0),
  ('00000000-0000-4000-8000-0000000c2091', 9900000000000912, 'GradedByV4',
   '2026-07-27'::timestamptz, 1, 'R1', 'offline', 0),
  ('00000000-0000-4000-8000-0000000c2091', 9900000000000912, 'GradedByV4',
   '2026-07-27'::timestamptz, 4, 'R3', 'score', 74.8);

insert into public.player_ranks (player_id, assigned_rank)
values
  ('00000000-0000-4000-8000-0000000c1091', 'R2'),
  ('00000000-0000-4000-8000-0000000c2091', 'R2');

-- The guard as 0091 writes it, run directly: `rebuild_rank_period` cannot be
-- called here because `build_rank_period` refuses a session with no app_role,
-- and calling it would also overwrite the fixture this file is about.
create function pg_temp.apply(period timestamptz)
returns void language sql as $$
  delete from public.player_ranks as pr
  where pr.assigned_rank in ('R1', 'R2', 'R3')
    and exists (
      select 1 from public.rank_period_latest as l
      where l.player_id = pr.player_id
        and l.period_start = period
        and l.scoring_version = (
          select max(scoring_version) from public.rank_period_snapshots
          where period_start = period)
        and l.tier is not null
    );
$$;

-- Before: the stale row really does look gradeable, which is why 0090 fell for it.
select is(
  (select tier from public.rank_period_latest
   where player_id = '00000000-0000-4000-8000-0000000c1091'
     and period_start = '2026-07-27'::timestamptz),
  'R1',
  'the skipped member does carry a tier — from the older version');

select is(
  (select scoring_version from public.rank_period_latest
   where player_id = '00000000-0000-4000-8000-0000000c1091'
     and period_start = '2026-07-27'::timestamptz),
  1,
  'and that tier is v1, not what this rebuild wrote');

select pg_temp.apply('2026-07-27'::timestamptz);

select is(
  (select assigned_rank from public.player_ranks
   where player_id = '00000000-0000-4000-8000-0000000c1091'),
  'R2',
  'a member this pass skipped keeps their rank rather than being judged by v1');

select is(
  (select count(*) from public.player_ranks
   where player_id = '00000000-0000-4000-8000-0000000c2091'),
  0::bigint,
  'and a member this pass did grade still has their override cleared');

-- The same fixture under 0090's guard, to show the two differ. Without this the
-- file passes whether or not the fix is in place.
create function pg_temp.apply_old(period timestamptz)
returns void language sql as $$
  delete from public.player_ranks as pr
  where pr.assigned_rank in ('R1', 'R2', 'R3')
    and exists (
      select 1 from public.rank_period_latest as l
      where l.player_id = pr.player_id
        and l.period_start = period
        and l.tier is not null
    );
$$;

select pg_temp.apply_old('2026-07-27'::timestamptz);

select is(
  (select count(*) from public.player_ranks
   where player_id = '00000000-0000-4000-8000-0000000c1091'),
  0::bigint,
  'the old guard DOES clear them — the two are not the same predicate');

-- And the function on the database carries the new one.
select ok(
  (select prosrc like '%scoring_version = current_version%'
   from pg_proc
   where proname = 'rebuild_rank_period'
     and pronamespace = 'public'::regnamespace),
  'the deployed function checks the version, not just the tier');

select * from finish();
rollback;
