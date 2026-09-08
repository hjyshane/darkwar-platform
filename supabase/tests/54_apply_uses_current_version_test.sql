-- 0091: a rebuild may only clear an override on the strength of its OWN answer.
--
-- The hole 0090 left: `build_rank_period` writes no row for a member it will not
-- grade, so in a period that still holds older rows, the newest row for that
-- member stays the OLD version's. 0090's guard read that stale tier and cleared a
-- rank the current formula never graded.
--
-- Every case below therefore mixes versions WITHIN one period, which is the only
-- shape where the two guards differ.
--
-- 0163 THEN REMOVED THE HAZARD ONE LEVEL DOWN, and this file now records that
-- rather than the difference it was written to show. `rank_period_latest`
-- serves each period at a single version, so the stale row is no longer
-- visible through it AT ALL -- and a guard that cannot see the row cannot act
-- on it, whichever predicate it carries. The two guards therefore agree today,
-- and 0091's `scoring_version = current_version` is defence in depth rather
-- than the only defence. That is worth pinning: if a later change ever serves
-- superseded rows through this view again, assertion 2 fails here before
-- anybody's override is cleared on the strength of a v1 answer.
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

-- The stale row is really there, in the table, looking perfectly gradeable.
-- This is the shape 0090 fell for, and asserting it first is what stops the
-- next assertion passing because the fixture never held the hazard.
select is(
  (select tier from public.rank_period_snapshots
   where player_id = '00000000-0000-4000-8000-0000000c1091'
     and period_start = '2026-07-27'::timestamptz
     and scoring_version = 1),
  'R1',
  'the skipped member does carry a tier — from the older version');

-- And 0163 does not serve it. The period is one version, this member has no
-- row at it, so they are absent rather than present with a v1 answer.
select is(
  (select count(*)::int from public.rank_period_latest
   where player_id = '00000000-0000-4000-8000-0000000c1091'
     and period_start = '2026-07-27'::timestamptz),
  0,
  'but the view does not serve it: a superseded row is out of the period, not in it at an old version');

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

-- The same fixture under 0090's guard. This used to show the two differ; since
-- 0163 it shows that they no longer can, which is the stronger outcome.
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

-- Once, this cleared them, and that difference was the point of the file. It
-- does not any more: 0163 took the row away from BOTH guards, so the version
-- clause has nothing left to discriminate. Asserted in its new form rather
-- than deleted, because the day this goes back to 0 is the day superseded rows
-- are visible again — and that is worth failing over.
select is(
  (select count(*) from public.player_ranks
   where player_id = '00000000-0000-4000-8000-0000000c1091'),
  1::bigint,
  'and the old guard cannot clear them either now — 0163 removed the row it used to read');

-- And the function on the database still carries the version clause. It is
-- redundant through this view today; it is not redundant against a future one.
select ok(
  (select prosrc like '%scoring_version = current_version%'
   from pg_proc
   where proname = 'rebuild_rank_period'
     and pronamespace = 'public'::regnamespace),
  'the deployed function checks the version, not just the tier');

select * from finish();
rollback;
