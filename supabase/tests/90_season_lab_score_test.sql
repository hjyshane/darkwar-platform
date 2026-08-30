-- 0159: while a season window is open, a season building moves the score.
--
-- The assertions are on `lab_level` and `lab_adjustment` rather than on the
-- tier, deliberately. The tier comes from a percentile of the adjusted score,
-- so what a ten-point penalty does to a tier depends entirely on how the rest
-- of the fixture is spread — a tier assertion here would be testing the shape
-- of the fixture, not the rule. `lab_adjustment` is the rule.
--
-- A PAST period is scored, not the current one, so that "a sighting after the
-- period ended" can be written without putting a timestamp in the future.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc90', 'season lab test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ad090', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'season-lab-admin@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad090', 'admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000ab090', 580, 'ext-season-lab', 'SeasonLabTest', true);

-- The period under test, and the one before it — which sits outside the
-- window and must therefore be scored the old way.
create function pg_temp.in_season() returns timestamptz language sql stable as $$
  select public.rank_period_start(now() - interval '30 days');
$$;
create function pg_temp.before_season() returns timestamptz language sql stable as $$
  select pg_temp.in_season() - interval '14 days';
$$;

-- Five members: one under the low level, one at the high level, one between
-- them, one the sweep has never covered, and one whose level rose only AFTER
-- the period closed.
insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000cb901', 580, 9900000000000001, 'Behind',
   '00000000-0000-4000-8000-0000000ab090'),
  ('00000000-0000-4000-8000-0000000cb902', 580, 9900000000000002, 'Ahead',
   '00000000-0000-4000-8000-0000000ab090'),
  ('00000000-0000-4000-8000-0000000cb903', 580, 9900000000000003, 'Between',
   '00000000-0000-4000-8000-0000000ab090'),
  ('00000000-0000-4000-8000-0000000cb904', 580, 9900000000000004, 'Unswept',
   '00000000-0000-4000-8000-0000000ab090'),
  ('00000000-0000-4000-8000-0000000cb905', 580, 9900000000000005, 'Late',
   '00000000-0000-4000-8000-0000000ab090');

-- Long before either period, so nobody is a witnessed newcomer (0072).
create function pg_temp.roster(uid bigint, pid uuid) returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id,
    member_rank, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'labr:' || uid,
    now() - interval '120 days', '00000000-0000-4000-8000-00000000cc90', 580,
    '00000000-0000-4000-8000-0000000ab090', 580, uid, pid, 2, false);
$$;

select pg_temp.roster(9900000000000001, '00000000-0000-4000-8000-0000000cb901');
select pg_temp.roster(9900000000000002, '00000000-0000-4000-8000-0000000cb902');
select pg_temp.roster(9900000000000003, '00000000-0000-4000-8000-0000000cb903');
select pg_temp.roster(9900000000000004, '00000000-0000-4000-8000-0000000cb904');
select pg_temp.roster(9900000000000005, '00000000-0000-4000-8000-0000000cb905');

-- A sighting of the thermal lab. `at` is what makes or breaks the probe.
create function pg_temp.lab(key text, uid bigint, lvl int, at timestamptz)
returns void language sql as $$
  insert into public.season_building_snapshots
    (observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, server_id,
     game_uid, object_id, point_id, x, y, building_type_id, level)
  values (gen_random_uuid(), 'world.get.new', 'test', key, at,
    '00000000-0000-4000-8000-00000000cc90', 580, 580,
    uid, uid, 593383, 593, 383, 862000, lvl);
$$;

select pg_temp.lab('lab:behind', 9900000000000001, 10, pg_temp.in_season() + interval '2 days');
select pg_temp.lab('lab:ahead', 9900000000000002, 25, pg_temp.in_season() + interval '2 days');
select pg_temp.lab('lab:between', 9900000000000003, 18, pg_temp.in_season() + interval '2 days');
-- 'Unswept' gets nothing, deliberately.
-- 'Late' was at 12 during the period and reached 30 a week after it closed.
select pg_temp.lab('lab:late:in', 9900000000000005, 12, pg_temp.in_season() + interval '2 days');
select pg_temp.lab('lab:late:after', 9900000000000005, 30, pg_temp.in_season() + interval '21 days');

-- Contributions, so the members have a score for the adjustment to move. The
-- figures are equal on purpose: any difference between these five scores is
-- then the season rule and nothing else.
create function pg_temp.donate(uid bigint, kind text, opens timestamptz)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, game_uid,
    contribution_type, score)
  values (gen_random_uuid(), 'al.rank.info', 'test',
    'labc:' || uid || ':' || kind || ':' || opens,
    opens + interval '1 day',
    '00000000-0000-4000-8000-00000000cc90', 580, 580, uid, kind, 5000);
$$;

do $$
declare uid bigint;
begin
  foreach uid in array array[9900000000000001, 9900000000000002, 9900000000000003,
                            9900000000000004, 9900000000000005]
  loop
    perform pg_temp.donate(uid, 'weekly_donation', pg_temp.in_season());
    perform pg_temp.donate(uid, 'alliance_battle_weekly', pg_temp.in_season());
    perform pg_temp.donate(uid, 'weekly_donation', pg_temp.before_season());
    perform pg_temp.donate(uid, 'alliance_battle_weekly', pg_temp.before_season());
  end loop;
end $$;

-- The window opens with the period under test and closes well after it, so
-- `in_season` is inside and `before_season` is not.
insert into public.app_settings (key, value)
values ('rank_tiers', jsonb_build_object(
  'r3_percent', 20,
  'r2_percent', 50,
  'offline_hours', 100000,
  'weights', jsonb_build_object('donation', 0.5, 'duel', 0.5, 'power_growth', 0),
  'minimums', jsonb_build_object('enabled', false, 'donation_weekly', 0, 'duel_weekly', 0),
  'season_lab', jsonb_build_object(
    'enabled', true,
    'starts_at', pg_temp.in_season(),
    'ends_at', pg_temp.in_season() + interval '60 days',
    'building_id', 862000,
    'low', 15,
    'high', 22,
    'penalty', 10,
    'bonus', 10)))
on conflict (key) do update set value = excluded.value;

create function pg_temp.adj(pid uuid, period timestamptz) returns numeric language sql as $$
  select lab_adjustment from public.rank_period_snapshots
  where player_id = pid and period_start = period and scoring_version = 6;
$$;
create function pg_temp.lvl(pid uuid, period timestamptz) returns int language sql as $$
  select lab_level from public.rank_period_snapshots
  where player_id = pid and period_start = period and scoring_version = 6;
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad090');
select lives_ok(
  $$ select public.build_rank_period(pg_temp.in_season()) $$,
  'a period inside the season window builds');
select lives_ok(
  $$ select public.build_rank_period(pg_temp.before_season()) $$,
  'and so does the one before it');
reset role;

-- ------------------------------------------------------ inside the window
select is(pg_temp.lvl('00000000-0000-4000-8000-0000000cb901', pg_temp.in_season()), 10,
  'the level seen during the period is what the score is judged on');
select is(pg_temp.adj('00000000-0000-4000-8000-0000000cb901', pg_temp.in_season()), -10::numeric,
  'a member under the low level loses the penalty');
select is(pg_temp.adj('00000000-0000-4000-8000-0000000cb902', pg_temp.in_season()), 10::numeric,
  'a member at or above the high level gains the bonus');
select is(pg_temp.adj('00000000-0000-4000-8000-0000000cb903', pg_temp.in_season()), 0::numeric,
  'a member between the two thresholds is scored exactly as before');

-- The rule that keeps the penalty off whoever the collector missed.
select is(pg_temp.lvl('00000000-0000-4000-8000-0000000cb904', pg_temp.in_season()), null::int,
  'a member the sweep never covered has no level');
select is(pg_temp.adj('00000000-0000-4000-8000-0000000cb904', pg_temp.in_season()), 0::numeric,
  'and is not penalised for it: an unseen level is not a low level');

-- The trap `member_season_buildings` would have walked into: that view is
-- newest-overall, so scoring through it would judge a finished period on a
-- level reached weeks later.
select is(pg_temp.lvl('00000000-0000-4000-8000-0000000cb905', pg_temp.in_season()), 12,
  'the level is the one that stood at the END of the period, not the newest');
select is(pg_temp.adj('00000000-0000-4000-8000-0000000cb905', pg_temp.in_season()), -10::numeric,
  'so a level reached after the period closed cannot rescue it');

-- The adjustment is a move in score points, so the two extremes must differ
-- by penalty + bonus and nothing else — the contributions are identical.
select is(
  (select round(max(activity_score) - min(activity_score))
   from public.rank_period_snapshots
   where period_start = pg_temp.in_season() and scoring_version = 6
     and player_id in ('00000000-0000-4000-8000-0000000cb902',
                       '00000000-0000-4000-8000-0000000cb903')),
  10::numeric,
  'the bonus moves the score by its own size and not by a weighted share of it');

-- ----------------------------------------------------- outside the window
select is(pg_temp.adj('00000000-0000-4000-8000-0000000cb901', pg_temp.before_season()), 0::numeric,
  'a period that OPENED before the season keeps the ordinary scoring');
select is(pg_temp.lvl('00000000-0000-4000-8000-0000000cb901', pg_temp.before_season()), null::int,
  'and records no level, because the probe never runs outside a window');

select finish();
rollback;
