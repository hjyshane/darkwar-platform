-- 0328: the readings move to two hours before the reset, and the duel half of
-- the score can count days over a per-weekday floor instead of summing points.
--
-- Three members over the fortnight 2026-08-03 → 08-17, duel weight 1 and the
-- rest 0, so duel_pct is the whole ordering:
--
--   Steady   weekly duel 100; daily board over the floor on Mon, Thu, Sat and
--            the second Monday, under it on Tue, and 999 on a Wednesday whose
--            floor is 0 (not asked for, not counted). Five days read, four met.
--   Burst    weekly duel 200; one Monday over the floor, and a 5000 on the
--            Sunday board — Sunday is not a duel day (0213) and must not count.
--   Weekly   weekly duel 999999 and never on the daily board at all.
--
-- Under points Burst beats Steady; under days Steady beats Burst. Weekly has
-- the biggest weekly figure and no daily figure, which under days is "not
-- read", not zero.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- The reading instants themselves (0328): Monday 00:00Z, two hours before the
-- reset, for a fortnight of any origin.
select is(public.rank_period_reading_ends('2026-08-03T02:00:00Z', '2026-08-17T02:00:00Z'),
  array['2026-08-10T00:00:00Z'::timestamptz, '2026-08-17T00:00:00Z'::timestamptz],
  'the weekly readings land at Monday 00:00Z, two hours before the boards clear');

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000c328', 'duel days test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ad328', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'duel-days-officer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad328', 'officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- This file's alliance is the only one marked ours, by evidence too (0196).
update public.alliances set is_own = false, roster_unredacted_seen = false
where is_own or roster_unredacted_seen;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000ab328', 580, 'ext-duel-days', 'DuelDaysTest', true);

insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000c3281', 580, 9328000000000001, 'Steady',
   '00000000-0000-4000-8000-0000000ab328'),
  ('00000000-0000-4000-8000-0000000c3282', 580, 9328000000000002, 'Burst',
   '00000000-0000-4000-8000-0000000ab328'),
  ('00000000-0000-4000-8000-0000000c3283', 580, 9328000000000003, 'Weekly',
   '00000000-0000-4000-8000-0000000ab328');

-- ONE captured_at for the whole roster: alliance_roster_latest keeps the rows
-- sharing the newest instant, so members written a moment apart are a roster
-- of one. Well before the period, so nobody is a witnessed newcomer (0072).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, presence_redacted)
select gen_random_uuid(), 'al.rank', 'test', 'dd328:roster:' || v.game_uid,
       '2026-06-01T02:00:00Z', '00000000-0000-4000-8000-00000000c328', 580,
       '00000000-0000-4000-8000-0000000ab328', 580, v.player_id, v.game_uid,
       v.name, 2, false
from (values
    ('00000000-0000-4000-8000-0000000c3281'::uuid, 9328000000000001::bigint, 'Steady'),
    ('00000000-0000-4000-8000-0000000c3282'::uuid, 9328000000000002::bigint, 'Burst'),
    ('00000000-0000-4000-8000-0000000c3283'::uuid, 9328000000000003::bigint, 'Weekly')
  ) as v(player_id, game_uid, name);

create function pg_temp.board(uid bigint, kind text, amount bigint, at timestamptz)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, game_uid,
    contribution_type, score, raw)
  values (gen_random_uuid(), 'test', 'test', 'dd328:' || uid || ':' || kind || ':' || at,
          at, '00000000-0000-4000-8000-00000000c328', 580, 580, uid, kind, amount, '{}'::jsonb);
$$;

-- The weekly board, inside week one's window (opens 08-03 02:00, closes 08-10 00:00).
select pg_temp.board(9328000000000001, 'alliance_battle_weekly', 100, '2026-08-09T13:00:00Z');
select pg_temp.board(9328000000000002, 'alliance_battle_weekly', 200, '2026-08-09T13:00:00Z');
select pg_temp.board(9328000000000003, 'alliance_battle_weekly', 999999, '2026-08-09T13:00:00Z');

-- The daily board, read at 01:59Z, the collector's sweep before the game day
-- turns over at 02:00Z. The game day is named by the date it starts on.
-- Steady: Mon 08-03 over, Tue 08-04 under, Wed 08-05 (floor 0), Thu 08-06
-- over, Sat 08-08 over the Saturday floor, Mon 08-10 over.
select pg_temp.board(9328000000000001, 'alliance_battle_daily', 150, '2026-08-04T01:59:00Z');
select pg_temp.board(9328000000000001, 'alliance_battle_daily', 50, '2026-08-05T01:59:00Z');
select pg_temp.board(9328000000000001, 'alliance_battle_daily', 999, '2026-08-06T01:59:00Z');
select pg_temp.board(9328000000000001, 'alliance_battle_daily', 150, '2026-08-07T01:59:00Z');
select pg_temp.board(9328000000000001, 'alliance_battle_daily', 2000, '2026-08-09T01:59:00Z');
select pg_temp.board(9328000000000001, 'alliance_battle_daily', 150, '2026-08-11T01:59:00Z');
-- Burst: Mon 08-03 over, and Sunday 08-09 read at 5000.
select pg_temp.board(9328000000000002, 'alliance_battle_daily', 150, '2026-08-04T01:30:00Z');
select pg_temp.board(9328000000000002, 'alliance_battle_daily', 5000, '2026-08-10T01:00:00Z');
-- Weekly: nothing daily, deliberately.

create function pg_temp.tiers(mode text) returns void language sql as $$
  insert into public.app_settings (key, value)
  values ('rank_tiers', jsonb_build_object(
    'r3_percent', 34,
    'r2_percent', 33,
    'offline_hours', 100000,
    'weights', jsonb_build_object('donation', 0, 'duel', 1, 'power_growth', 0),
    'duel_scoring', mode,
    'duel_daily_minimums', jsonb_build_object(
      'mon', 100, 'tue', 100, 'wed', 0, 'thu', 100, 'fri', 100, 'sat', 1000)))
  on conflict (key) do update set value = excluded.value;
$$;

create function pg_temp.row_of(who text) returns public.rank_period_latest
language sql as $$
  select * from public.rank_period_latest
  where period_start = '2026-08-03T02:00:00Z' and name = who;
$$;

-- -------------------------------------------------------------------- days
select pg_temp.tiers('days');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad328');
select lives_ok(
  $$ select public.build_rank_period('2026-08-03T02:00:00Z') $$,
  'the period builds under duel_scoring = days');
reset role;

select is((pg_temp.row_of('Steady')).duel_days_read, 5,
  'five duel days with a floor were read for Steady — the Wednesday with no floor is not one');
select is((pg_temp.row_of('Steady')).duel_days_met, 4,
  'four of them met the weekday floor; the Tuesday under it did not');
select is((pg_temp.row_of('Burst')).duel_days_read, 1,
  'the Sunday board is not a duel day and is not read as one');
select is((pg_temp.row_of('Burst')).duel_days_met, 1,
  'so Burst met one day, not two');
select is((pg_temp.row_of('Weekly')).duel_days_met, null,
  'a member never on the daily board is not read, which is null and not zero');
select is((pg_temp.row_of('Weekly')).duel_total, 999999::bigint,
  'the weekly points are still read and stored under days');
select is((pg_temp.row_of('Steady')).duel_scoring, 'days',
  'the row says which duel figure it was ranked on');
select cmp_ok((pg_temp.row_of('Steady')).duel_pct, '>', (pg_temp.row_of('Burst')).duel_pct,
  'under days the member with more days met ranks above the member with more points');

-- ------------------------------------------------------------------ points
select pg_temp.tiers('points');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad328');
select lives_ok(
  $$ select public.build_rank_period('2026-08-03T02:00:00Z') $$,
  'and rebuilds under points');
reset role;

select is((pg_temp.row_of('Steady')).duel_days_met, null,
  'under points no days are counted');
select is((pg_temp.row_of('Steady')).duel_scoring, 'points',
  'and the row says so');
select cmp_ok((pg_temp.row_of('Burst')).duel_pct, '>', (pg_temp.row_of('Steady')).duel_pct,
  'under points the member with more points ranks above the member with more days');

select * from finish();
rollback;
