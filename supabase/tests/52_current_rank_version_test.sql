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
--
-- 0163 MOVED WHERE THAT IS DECIDED, and this file had to follow. The tie-break
-- is no longer `player_current_rank`'s: `rank_period_latest` now serves each
-- period at ONE version -- the newest that exists FOR THE PERIOD -- so a member
-- with no row at that version is absent from the period rather than served at
-- an older one. The property this file is about survives unchanged; what
-- changed is that a fixture giving one member a version the rest of the period
-- does not have no longer means "that member is served at their own newest
-- version", it means "that member is not in that period at all".
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000c1089', 580, 9900000000000891, 'Rebuilt'),
  ('00000000-0000-4000-8000-0000000c2089', 580, 9900000000000892, 'OlderPeriod'),
  ('00000000-0000-4000-8000-0000000c3089', 580, 9900000000000893, 'HandSetOnly'),
  ('00000000-0000-4000-8000-0000000c4089', 580, 9900000000000894, 'SupersededOnly');

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
--
-- The versions are per PERIOD now, so that is expressed by giving 07-20 a
-- version nothing else has: it is served at 5, and 08-03 is served at 4. The
-- newer period must still win. The v2 and v3 rows stay because they are the
-- shape the file exists for -- superseded rows sitting in the same period --
-- and 0163 is what filters them out.
select pg_temp.snap('00000000-0000-4000-8000-0000000c2089', '2026-07-20', 5, 'R3', 80.0);
select pg_temp.snap('00000000-0000-4000-8000-0000000c2089', '2026-08-03', 2, 'R1', 5.0);
select pg_temp.snap('00000000-0000-4000-8000-0000000c2089', '2026-08-03', 3, 'R2', 30.0);
select pg_temp.snap('00000000-0000-4000-8000-0000000c2089', '2026-08-03', 4, 'R2', 30.0);

-- Scored only by a version that 08-03 has since moved past. 0163's rule says
-- they are not in that period at all: they were not measured by the rule that
-- produced its result, and the honest report of that is nothing rather than a
-- number from a different rulebook. The hand-set rank keeps them on the roster
-- so the withheld tier is visible rather than the whole row disappearing.
select pg_temp.snap('00000000-0000-4000-8000-0000000c4089', '2026-08-03', 2, 'R1', 5.0);
insert into public.player_ranks (player_id, assigned_rank)
values ('00000000-0000-4000-8000-0000000c4089', 'R3');

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

select is(
  (select computed_tier from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c4089'),
  null,
  'a member scored only by a superseded version of a period gets no tier from it');

select * from finish();
rollback;
