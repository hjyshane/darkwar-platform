-- 0329: a member who joined during a HAND-SET period is scored over the share
-- of it they were on the roster for. On the grid they stay unmeasured.
--
-- A three-week period set by hand, 2026-08-03 → 08-24, donation weight 1 and
-- duel 0 so donation_pct is the whole ordering (the duel percentile is still
-- computed and asserted on its own):
--
--   Veteran    on the roster since June. 1000 donated and 100 duelled a week,
--              three weeks: totals 3000 and 300, share 1.
--   Latecomer  first seen Wednesday 08-05 02:00Z, so 19 of 21 days on the
--              roster: share 19/21 ≈ 0.9048. Donates 500 in the partial first
--              week and 1500 in each whole week (total 3500), duels 100 a week
--              (total 300, the same as Veteran). Over the share both figures
--              are larger than Veteran's, so Latecomer ranks above on both.
--   Straggler  first seen Tuesday 08-18, inside the LAST week: no whole week,
--              so still unmeasured, however much they donated.
--
-- The weekly minimum is 1200. Veteran's 1000 a week is under it every week;
-- Latecomer's 500 came in a week that opened before they were on the roster,
-- which is a partial week and not held against them.
--
-- Then the override is deleted, the same start is a grid fortnight, and
-- Latecomer - with a whole second week on the roster - is unmeasured again.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000c329', 'newcomer test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ad329', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'newcomer-officer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad329', 'officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- This file's alliance is the only one marked ours, by evidence too (0196).
update public.alliances set is_own = false, roster_unredacted_seen = false
where is_own or roster_unredacted_seen;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000ab329', 580, 'ext-newcomer', 'NewcomerTest', true);

-- The hand-set period: three weeks from the 08-03 reset. Written as the owner;
-- 316 owns the gate.
insert into public.rank_period_overrides (alliance_id, period_start, period_end, note)
values ('00000000-0000-4000-8000-0000000ab329', '2026-08-03T02:00:00Z', '2026-08-24T02:00:00Z',
        'three weeks');

insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000c3291', 580, 9329000000000001, 'Veteran',
   '00000000-0000-4000-8000-0000000ab329'),
  ('00000000-0000-4000-8000-0000000c3292', 580, 9329000000000002, 'Latecomer',
   '00000000-0000-4000-8000-0000000ab329'),
  ('00000000-0000-4000-8000-0000000c3293', 580, 9329000000000003, 'Straggler',
   '00000000-0000-4000-8000-0000000ab329');

create function pg_temp.roster(pid uuid, uid bigint, who text, at timestamptz)
returns void language sql as $$
  insert into public.alliance_member_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, alliance_id, server_id, player_id,
     game_uid, name, member_rank, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'nc329:roster:' || uid || ':' || at, at,
          '00000000-0000-4000-8000-00000000c329', 580,
          '00000000-0000-4000-8000-0000000ab329', 580, pid, uid, who, 2, false);
$$;

-- THE JOIN HISTORY: Veteran in June, Latecomer on the Wednesday of week one,
-- Straggler on the Tuesday of week three. Veteran's June row is also the
-- alliance's first roster capture, so the other two are joins we witnessed.
select pg_temp.roster('00000000-0000-4000-8000-0000000c3291', 9329000000000001, 'Veteran',
  '2026-06-01T02:00:00Z');
select pg_temp.roster('00000000-0000-4000-8000-0000000c3292', 9329000000000002, 'Latecomer',
  '2026-08-05T02:00:00Z');
select pg_temp.roster('00000000-0000-4000-8000-0000000c3293', 9329000000000003, 'Straggler',
  '2026-08-18T12:00:00Z');
-- AND THE ROSTER AS IT STANDS: one captured_at holding all three, because
-- alliance_roster_latest keeps only the rows sharing the newest instant.
select pg_temp.roster('00000000-0000-4000-8000-0000000c3291', 9329000000000001, 'Veteran',
  '2026-08-20T02:00:00Z');
select pg_temp.roster('00000000-0000-4000-8000-0000000c3292', 9329000000000002, 'Latecomer',
  '2026-08-20T02:00:00Z');
select pg_temp.roster('00000000-0000-4000-8000-0000000c3293', 9329000000000003, 'Straggler',
  '2026-08-20T02:00:00Z');

create function pg_temp.board(uid bigint, kind text, amount bigint, at timestamptz)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, game_uid,
    contribution_type, score, raw)
  values (gen_random_uuid(), 'test', 'test', 'nc329:' || uid || ':' || kind || ':' || at,
          at, '00000000-0000-4000-8000-00000000c329', 580, 580, uid, kind, amount, '{}'::jsonb);
$$;

-- Weekly boards, each read on its Sunday afternoon, inside its week's window
-- (opens at the reset, closes Monday 00:00Z).
-- Veteran: 1000 / 100 every week.
select pg_temp.board(9329000000000001, 'weekly_donation', 1000, '2026-08-09T13:00:00Z');
select pg_temp.board(9329000000000001, 'weekly_donation', 1000, '2026-08-16T13:00:00Z');
select pg_temp.board(9329000000000001, 'weekly_donation', 1000, '2026-08-23T13:00:00Z');
select pg_temp.board(9329000000000001, 'alliance_battle_weekly', 100, '2026-08-09T13:00:00Z');
select pg_temp.board(9329000000000001, 'alliance_battle_weekly', 100, '2026-08-16T13:00:00Z');
select pg_temp.board(9329000000000001, 'alliance_battle_weekly', 100, '2026-08-23T13:00:00Z');
-- Latecomer: 500 in the partial first week, 1500 in each whole week; 100 duel
-- every week, which is Veteran's duel total exactly.
select pg_temp.board(9329000000000002, 'weekly_donation', 500, '2026-08-09T13:00:00Z');
select pg_temp.board(9329000000000002, 'weekly_donation', 1500, '2026-08-16T13:00:00Z');
select pg_temp.board(9329000000000002, 'weekly_donation', 1500, '2026-08-23T13:00:00Z');
select pg_temp.board(9329000000000002, 'alliance_battle_weekly', 100, '2026-08-09T13:00:00Z');
select pg_temp.board(9329000000000002, 'alliance_battle_weekly', 100, '2026-08-16T13:00:00Z');
select pg_temp.board(9329000000000002, 'alliance_battle_weekly', 100, '2026-08-23T13:00:00Z');
-- Straggler: a big week three, which must count for nothing.
select pg_temp.board(9329000000000003, 'weekly_donation', 9000, '2026-08-23T13:00:00Z');
select pg_temp.board(9329000000000003, 'alliance_battle_weekly', 900, '2026-08-23T13:00:00Z');

-- The daily board, for the `days` check at the end. Game day Mon 08-03 is read
-- at 08-04 01:59Z. Veteran meets Mon and Tue of week one; Latecomer has a Mon
-- 08-03 reading - a day before they were on the roster, which must not be
-- asked for - and meets Thu and Fri.
select pg_temp.board(9329000000000001, 'alliance_battle_daily', 150, '2026-08-04T01:59:00Z');
select pg_temp.board(9329000000000001, 'alliance_battle_daily', 150, '2026-08-05T01:59:00Z');
select pg_temp.board(9329000000000002, 'alliance_battle_daily', 150, '2026-08-04T01:59:00Z');
select pg_temp.board(9329000000000002, 'alliance_battle_daily', 150, '2026-08-07T01:59:00Z');
select pg_temp.board(9329000000000002, 'alliance_battle_daily', 150, '2026-08-08T01:59:00Z');

create function pg_temp.tiers(mode text) returns void language sql as $$
  insert into public.app_settings (key, value)
  values ('rank_tiers', jsonb_build_object(
    'r3_percent', 50,
    'r2_percent', 50,
    'offline_hours', 100000,
    'weights', jsonb_build_object('donation', 1, 'duel', 0, 'power_growth', 0),
    'minimums', jsonb_build_object('enabled', true, 'donation_weekly', 1200, 'duel_weekly', 0),
    'duel_scoring', mode,
    'duel_daily_minimums', jsonb_build_object(
      'mon', 100, 'tue', 100, 'wed', 100, 'thu', 100, 'fri', 100, 'sat', 100)))
  on conflict (key) do update set value = excluded.value;
$$;
select pg_temp.tiers('points');

create function pg_temp.row_of(who text) returns public.rank_period_latest
language sql as $$
  select * from public.rank_period_latest
  where period_start = '2026-08-03T02:00:00Z' and name = who;
$$;

create function pg_temp.build() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform pg_temp.act_as('00000000-0000-4000-8000-0000000ad329');
  perform public.build_rank_period('2026-08-03T02:00:00Z');
  reset role;
end;
$$;

-- ------------------------------------------------------- hand-set, points
select lives_ok($$ select pg_temp.build() $$, 'the three-week period builds');

-- Latecomer is scored.
select is((pg_temp.row_of('Latecomer')).tier_reason,
  'score, over the 90% of the period on the roster',
  'a member who joined in week one of a hand-set period is scored, and the row says over what');
select isnt((pg_temp.row_of('Latecomer')).tier, null, 'and has a tier');
select is(round((pg_temp.row_of('Latecomer')).measured_share, 4), 0.9048,
  'the share is the 19 of 21 days from the first sighting to the end');
select is((pg_temp.row_of('Latecomer')).donation_total, 3500::bigint,
  'the stored total is what was read, the partial week included');
select cmp_ok((pg_temp.row_of('Latecomer')).donation_pct, '>', (pg_temp.row_of('Veteran')).donation_pct,
  '3500 over 90% of the period outranks 3000 over all of it');
select is((pg_temp.row_of('Latecomer')).duel_total, (pg_temp.row_of('Veteran')).duel_total,
  'the two duel totals are equal');
select cmp_ok((pg_temp.row_of('Latecomer')).duel_pct, '>', (pg_temp.row_of('Veteran')).duel_pct,
  'and the one earned over a shorter stay ranks higher');

-- The partial week and the minimum.
select is((pg_temp.row_of('Veteran')).below_minimum, true,
  '1000 a week is under the 1200 floor');
select is((pg_temp.row_of('Latecomer')).below_minimum, false,
  'but 500 in a week that opened before the member joined is a partial week, not a miss');

-- Veteran is untouched by the rule.
select is((pg_temp.row_of('Veteran')).measured_share, 1::numeric,
  'a member there all along has a share of 1');
select is((pg_temp.row_of('Veteran')).tier_reason, 'below minimum: donation',
  'and reads as before');

-- Straggler has no whole week.
select is((pg_temp.row_of('Straggler')).tier_reason, 'not measured: joined during this period',
  'a member first seen inside the last week is still unmeasured');
select is((pg_temp.row_of('Straggler')).tier, null, 'with no tier');
select is((pg_temp.row_of('Straggler')).measured_share, 1::numeric,
  'and no share, because nothing was scaled');

-- --------------------------------------------------------- hand-set, days
select pg_temp.tiers('days');
select lives_ok($$ select pg_temp.build() $$, 'and rebuilds under duel_scoring = days');

select is((pg_temp.row_of('Latecomer')).duel_days_read, 2,
  'the Monday before the member was on the roster is not a duel day for them');
select is((pg_temp.row_of('Latecomer')).duel_days_met, (pg_temp.row_of('Veteran')).duel_days_met,
  'two days met each');
select cmp_ok((pg_temp.row_of('Latecomer')).duel_pct, '>', (pg_temp.row_of('Veteran')).duel_pct,
  'and two days over 90% of the period outrank two over all of it');

-- ------------------------------------------------------------------ grid
-- No override: the same start is a fortnight on the grid, and the rule does
-- not reach it. Latecomer has the whole of week two and is unmeasured anyway.
delete from public.rank_period_overrides
where alliance_id = '00000000-0000-4000-8000-0000000ab329';
select pg_temp.tiers('points');
select lives_ok($$ select pg_temp.build() $$, 'the grid fortnight builds');

select is((pg_temp.row_of('Latecomer')).tier_reason, 'not measured: joined during this period',
  'on the grid a member who joined during the period is unmeasured, as since 0072');
select is((pg_temp.row_of('Latecomer')).measured_share, 1::numeric,
  'and nothing was scaled');

select * from finish();
rollback;
