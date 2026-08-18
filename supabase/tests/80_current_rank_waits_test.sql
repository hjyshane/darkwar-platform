-- 0134: the rank a member is shown as holding comes from a finished fortnight.
--
-- 0132 gated the movement block and 78 asserts it. This is the other half of
-- the same screen: the rank column in the member list below, which read "the
-- newest period that exists" for two more migrations and so graded 94 people
-- off a fortnight two hours old.
--
-- Four things are pinned, and they fail in different directions. The wait is
-- the point of the change; the "still visible the moment it closes" assertion
-- is what stops the wait becoming "skip the newest"; the hand-set rank
-- surviving with no finished period at all is the full join still doing its
-- job, which is easy to break by moving the filter one line up; and the
-- scoring-version pick is 0089's fix, which this must not undo.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000fe001', 580, 9800000000000011, 'Waiting'),
  ('00000000-0000-4000-8000-0000000fe002', 580, 9800000000000012, 'HandSet');

create function pg_temp.period(
  who uuid, uid bigint, at timestamptz, tier text, score numeric, version int default 4)
returns void language sql as $$
  insert into public.rank_period_snapshots (
    period_start, player_id, game_uid, name, activity_score, tier, scoring_version)
  values (at, who, uid, 'x', score, tier, version);
$$;

-- A finished fortnight, and one that opened an hour ago carrying a worse tier
-- because three of its four readings are still empty. This is the production
-- shape: 2026-08-17 built two hours after it opened, against 08-03.
select pg_temp.period('00000000-0000-4000-8000-0000000fe001', 9800000000000011,
  now() - interval '4 weeks', 'R3', 80);
select pg_temp.period('00000000-0000-4000-8000-0000000fe001', 9800000000000011,
  date_trunc('hour', now()) - interval '1 hour', 'R1', 17);

select is(
  (select computed_tier from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe001'),
  'R3',
  'the finished fortnight decides the rank, not the one that opened an hour '
  'ago with a quarter of its readings in');

select is(
  (select period_start from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe001'),
  (now() - interval '4 weeks')::timestamptz,
  'and the view says which period that was, so a reader can tell how old the '
  'answer is');

-- The wait cannot be "ignore the most recent row". A fortnight that closed one
-- minute ago is the current answer and must take over on its own — without
-- this, the gate would be indistinguishable from an off-by-one that always
-- reports the period before last.
select pg_temp.period('00000000-0000-4000-8000-0000000fe001', 9800000000000011,
  now() - interval '2 weeks' - interval '1 minute', 'R2', 55);

select is(
  (select computed_tier from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe001'),
  'R2',
  'a fortnight that closed a minute ago takes over immediately - the rule is '
  'finished, not old');

-- 0089's pick, which this must not undo: one period holds a row per scoring
-- version and the newest version is the answer. Asserted on the FINISHED
-- period, because that is now the only one the view can reach.
select pg_temp.period('00000000-0000-4000-8000-0000000fe001', 9800000000000011,
  now() - interval '2 weeks' - interval '1 minute', 'R3', 90, 5);

select is(
  (select computed_tier from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe001'),
  'R3',
  'and within that period the newest scoring version still wins - 0134 chose '
  'the period, it did not take back 0089''s choice of version');

-- A member with a hand-set rank and no period at all. The filter belongs
-- inside the subquery; moved outside it, this row disappears and an admin's
-- own decision vanishes from the roster.
insert into public.player_ranks (player_id, assigned_rank)
values ('00000000-0000-4000-8000-0000000fe002', 'R4');

select is(
  (select assigned_rank from public.player_current_rank
    where player_id = '00000000-0000-4000-8000-0000000fe002'),
  'R4',
  'a hand-set rank shows with no finished period behind it - it never came '
  'from a period and must not wait for one');

select * from finish();
rollback;
