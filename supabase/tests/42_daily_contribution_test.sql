-- 0074: the daily totals, and the three ways they can be wrong by a factor.
--
-- Every assertion here corresponds to a mistake that produces a plausible
-- number rather than an error: a day split in two, a total counted twice, and a
-- total that includes half the server. None of them would show up as a failure
-- on screen — just as a chart that is confidently wrong.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc74', 'daily test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad074', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'daily-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce074', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'daily-nobody@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad074', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.alliances (alliance_id, server_id, external_id, current_name, member_count)
values ('00000000-0000-4000-8000-0000000ab074', 580, 'ext-daily', 'DailyTest', 2);

-- Two members of ours, and one stranger who is on the same cross-alliance board.
create function pg_temp.roster(uid bigint, at timestamptz)
returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid,
    member_rank, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'dailyr:' || uid || ':' || at,
    at, '00000000-0000-4000-8000-00000000cc74', 580,
    '00000000-0000-4000-8000-0000000ab074', 580, uid, 2, false);
$$;

select pg_temp.roster(9400000000000001, '2026-08-04T05:00:00Z');
select pg_temp.roster(9400000000000002, '2026-08-04T05:00:00Z');

create function pg_temp.donate(uid bigint, kind text, score bigint, at timestamptz)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, game_uid,
    contribution_type, score)
  values (gen_random_uuid(), 'get.daily.alliance.donate.rank', 'test',
    'dailyc:' || uid || ':' || kind || ':' || at, at,
    '00000000-0000-4000-8000-00000000cc74', 580, 580, uid, kind, score);
$$;

-- ---------------------------------------------------------------- the game day
-- 01:00 UTC on the 6th belongs to the game day that STARTED at 02:00 on the 5th.
-- Bucketing by calendar date splits one day across two rows and halves both.
select pg_temp.donate(9400000000000001, 'daily_donation', 100, '2026-08-05T23:00:00Z');
select pg_temp.donate(9400000000000002, 'daily_donation', 50, '2026-08-06T01:00:00Z');

-- ------------------------------------------------------- the accumulating board
-- The same player read three times on one game day, the board climbing each
-- time. The day is 900, not 100 + 400 + 900.
select pg_temp.donate(9400000000000001, 'alliance_battle_daily', 100, '2026-08-04T04:00:00Z');
select pg_temp.donate(9400000000000001, 'alliance_battle_daily', 400, '2026-08-04T12:00:00Z');
select pg_temp.donate(9400000000000001, 'alliance_battle_daily', 900, '2026-08-04T20:00:00Z');

-- -------------------------------------------------------------- the outsider's row
-- al.battle.rank.info comes back with 189 rows for an alliance of 94, because
-- the board is cross-alliance. This uid was never in our roster.
select pg_temp.donate(9499999999999999, 'alliance_battle_daily', 500000, '2026-08-04T20:00:00Z');

set local role authenticated;

-- Negative first (§20.2). The view reads a table 0066 shut to officers, so it is
-- DEFINER, so the gate has to be proven before anything else about it is.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce074');
select is(
  (select count(*) from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'),
  0::bigint,
  'somebody with no app_users row reads no daily totals');

select pg_temp.act_as('00000000-0000-4000-8000-0000000ad074');

-- And the positive half, because a gate that refuses everybody passes every
-- negative test ever written (0055).
select is(
  (select count(*) from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'),
  2::bigint,
  'a member reads one row per game day per kind — two kinds, one day each');

-- 23:00 on the 5th and 01:00 on the 6th are the SAME game day, so both members
-- land in one row and it totals 150.
select is(
  (select game_day from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'
      and kind = 'daily_donation'),
  '2026-08-05T02:00:00Z'::timestamptz,
  'the game day starts at 02:00 UTC, so a 01:00 capture belongs to the day before');
select is(
  (select total from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'
      and kind = 'daily_donation'),
  150::numeric,
  'and both members'' donations land in that one day rather than in two');
select is(
  (select members_counted from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'
      and kind = 'daily_donation'),
  2::bigint,
  'counted as two members, which is what makes the average mean anything');

-- THE ONE THAT MATTERS MOST. Three readings of an accumulating board: 100, 400,
-- 900. The day is 900. Summing the captures gives 1400 — a plausible figure, 56%
-- too high, and nothing on screen would say so.
select is(
  (select total from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'
      and kind = 'alliance_battle_daily'),
  900::numeric,
  'a day is the largest reading taken that day, not the sum of the readings');
select is(
  (select readings from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'
      and kind = 'alliance_battle_daily'),
  3::bigint,
  'and the row carries how many readings it had, so a one-reading day is legible');

-- The stranger's 500,000 dwarfs everything ours. If the view did not restrict to
-- our roster the total would be 500,900 and would move when they played.
select is(
  (select members_counted from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'
      and kind = 'alliance_battle_daily'),
  1::bigint,
  'the cross-alliance board is restricted to our own people');
select isnt(
  (select total from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-0000000ab074'
      and kind = 'alliance_battle_daily'),
  500900::numeric,
  'so a stranger on the same board contributes nothing to our total');

reset role;

select * from finish();
rollback;
