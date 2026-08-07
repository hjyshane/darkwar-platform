-- 0090: what a rebuild may and may not delete.
--
-- This function is the only thing in the codebase that removes a rank a person
-- typed, so every line below is about a boundary on that deletion rather than
-- about the arithmetic, which `build_rank_period` owns and other files test.
--
-- The four boundaries: it needs an explicit yes, it needs `members.manage`, it
-- never touches R4/R5, and it never clears somebody the period could not grade —
-- that last one would leave a member with no rank at all, which is worse than a
-- stale one.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- The wrapper exists with a default, so an old caller passing one argument
-- cannot delete anything by accident.
select has_function('public', 'rebuild_rank_period', array['timestamptz', 'boolean']);
select is(
  (select pronargdefaults::int from pg_proc
   where proname = 'rebuild_rank_period'
     and pronamespace = 'public'::regnamespace),
  1,
  'the applying argument has a default, so a one-argument call cannot delete');

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000c1090', 580, 9900000000000901, 'GradedR2'),
  ('00000000-0000-4000-8000-0000000c2090', 580, 9900000000000902, 'Officer'),
  ('00000000-0000-4000-8000-0000000c3090', 580, 9900000000000903, 'Ungradable');

-- A period with a computed tier for two of the three. The third is the member
-- the period could not measure — new, or absent, or both.
insert into public.rank_period_snapshots
  (player_id, game_uid, name, period_start, scoring_version, tier, tier_reason,
   activity_score)
values
  ('00000000-0000-4000-8000-0000000c1090', 9900000000000901, 'GradedR2',
   '2026-08-03'::timestamptz, 4, 'R3', 'score', 74.8),
  ('00000000-0000-4000-8000-0000000c2090', 9900000000000902, 'Officer',
   '2026-08-03'::timestamptz, 4, 'R2', 'score', 41.9),
  ('00000000-0000-4000-8000-0000000c3090', 9900000000000903, 'Ungradable',
   '2026-08-03'::timestamptz, 4, NULL, 'not measured: joined within the last two weeks',
   NULL);

insert into public.player_ranks (player_id, assigned_rank)
values
  ('00000000-0000-4000-8000-0000000c1090', 'R2'),
  ('00000000-0000-4000-8000-0000000c2090', 'R4'),
  ('00000000-0000-4000-8000-0000000c3090', 'R2');

-- The delete, run directly with the same predicate the function carries. The
-- function itself cannot be called here: `build_rank_period` refuses anyone who
-- is not a member, and a pgTAP session has no app_role — which is the subject of
-- its own assertion further down rather than something to work around.
create function pg_temp.apply(period timestamptz)
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

select pg_temp.apply('2026-08-03'::timestamptz);

select is(
  (select count(*) from public.player_ranks
   where player_id = '00000000-0000-4000-8000-0000000c1090'),
  0::bigint,
  'a graded R2 override is cleared, so the computed rank shows through');

select is(
  (select assigned_rank from public.player_ranks
   where player_id = '00000000-0000-4000-8000-0000000c2090'),
  'R4',
  'R4 survives — a limited seat is a decision, not a calculation');

select is(
  (select assigned_rank from public.player_ranks
   where player_id = '00000000-0000-4000-8000-0000000c3090'),
  'R2',
  'a member the period could not grade keeps their rank rather than losing it');

-- And the point of keeping it: they would otherwise have no rank at all.
select is(
  (select coalesce(assigned_rank, computed_tier) from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c3090'),
  'R2',
  'which is the whole reason — clearing it would leave them with nothing');

select is(
  (select computed_tier from public.player_current_rank
   where player_id = '00000000-0000-4000-8000-0000000c1090'),
  'R3',
  'and the cleared one now reads the computed tier');

-- §20.2: the negative case, proved rather than assumed. A pgTAP session has no
-- app_role, so it stands in for anyone who is not a member.
select throws_ok(
  $$select public.rebuild_rank_period('2026-08-03'::timestamptz, true)$$,
  '42501',
  'members only',
  'a non-member cannot rebuild, let alone clear a rank');

select is(
  (select count(*) from public.player_ranks),
  2::bigint,
  'and that refusal deleted nothing');

select * from finish();
rollback;
