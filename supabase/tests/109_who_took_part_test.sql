-- 0204: the participation report and the attendance officers type in.
--
-- Fixed dates throughout, all inside the game week opening Monday
-- 2026-09-14 02:00 UTC, so nothing depends on the day the suite runs. The
-- refusals come first: a write that got past them would put invented
-- attendance against somebody's name (§20.2).
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

-- ---------------------------------------------------------------- set-up

-- The held days 0212 declares fall in this week; this file tests ticks alone.
delete from public.attendance_event_days;

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-00000000a901', 580, 'ext-part', 'PartTest', true, 2),
  -- Somebody else's alliance, whose typed rows must stay out of sight.
  ('00000000-0000-4000-8000-00000000a902', 580, 'ext-other', 'OtherTest', false, 0);
-- Pinned, for the reason 92 gives.
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000a901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000a101', 580, 9230000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000a102', 580, 9230000000000102, 'Bravo', 80, 29),
  -- Not a member. Readings of theirs must not make a day "read".
  ('00000000-0000-4000-8000-00000000a103', 580, 9230000000000103, 'Charlie', 70, 28);

-- One batch, one captured_at (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000a0b1', 'al.rank', 'test',
       'test:109:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000a901', 580, v.player_id,
       v.game_uid, v.name, v.member_rank, 30, v.power, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000a101'::uuid, 9230000000000101::bigint, 'Alpha', 4, 90::bigint),
    ('00000000-0000-4000-8000-00000000a102'::uuid, 9230000000000102::bigint, 'Bravo', 3, 80::bigint)
  ) as v(player_id, game_uid, name, member_rank, power);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'part-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000a302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'part-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000a303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'part-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000a301', 'viewer', 'part viewer'),
  ('00000000-0000-4000-8000-00000000a302', 'member', 'part member'),
  ('00000000-0000-4000-8000-00000000a303', 'officer', 'part officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

create function pg_temp.reading(key text, uid bigint, kind text, at timestamptz, score bigint)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, contribution_type, score)
  values ('00000000-0000-4000-8000-00000000a0b2', 'test.board', 'test', 'test:109:' || key,
          at, '00000000-0000-4000-8000-000000000c01', 580, 580, uid, kind, score);
$$;

create function pg_temp.building(key text, uid bigint, object_id bigint, at timestamptz, lvl int)
returns void language sql as $$
  insert into public.season_building_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid, object_id,
     point_id, x, y, building_type_id, level)
  -- player_id as the collector writes it: member_participation (0238) reads the
  -- newest level per player and building type through it.
  select '00000000-0000-4000-8000-00000000a0b3', 'test.map', 'test', 'test:109:' || key,
          at, '00000000-0000-4000-8000-000000000c01', 580, 580,
          (select p.player_id from public.players p where p.game_uid = uid), uid, object_id,
          object_id, 1, 1, 744000, lvl;
$$;

-- Duel, daily. 09-14: Alpha 100 then 150 later the same day, Bravo 50.
-- 09-15: Alpha 0, Bravo absent. 09-16: only Charlie, who is not a member.
select pg_temp.reading('dd1', 9230000000000101, 'alliance_battle_daily', '2026-09-14T10:00:00Z', 100);
select pg_temp.reading('dd2', 9230000000000101, 'alliance_battle_daily', '2026-09-14T20:00:00Z', 150);
select pg_temp.reading('dd3', 9230000000000102, 'alliance_battle_daily', '2026-09-14T10:00:00Z', 50);
select pg_temp.reading('dd4', 9230000000000101, 'alliance_battle_daily', '2026-09-15T10:00:00Z', 0);
select pg_temp.reading('dd5', 9230000000000103, 'alliance_battle_daily', '2026-09-16T10:00:00Z', 70);
-- Duel, weekly. Alpha 1000 inside the week; Bravo only in the NEXT week.
select pg_temp.reading('dw1', 9230000000000101, 'alliance_battle_weekly', '2026-09-20T12:00:00Z', 1000);
select pg_temp.reading('dw2', 9230000000000102, 'alliance_battle_weekly', '2026-09-21T03:00:00Z', 999);
-- Donations, weekly. Alpha read at 0: on the board, scored nothing.
select pg_temp.reading('gw1', 9230000000000101, 'weekly_donation', '2026-09-20T12:00:00Z', 0);
select pg_temp.reading('gw2', 9230000000000102, 'weekly_donation', '2026-09-20T12:00:00Z', 40);

-- Season buildings. Alpha's was level 3 before the week, then 5 and 6 inside
-- it: three levels. Bravo's is first seen inside the week at 2, then 4: two.
select pg_temp.building('b1', 9230000000000101, 71, '2026-09-10T10:00:00Z', 3);
select pg_temp.building('b2', 9230000000000101, 71, '2026-09-16T10:00:00Z', 5);
select pg_temp.building('b3', 9230000000000101, 71, '2026-09-18T10:00:00Z', 6);
select pg_temp.building('b4', 9230000000000102, 72, '2026-09-15T10:00:00Z', 2);
select pg_temp.building('b5', 9230000000000102, 72, '2026-09-19T10:00:00Z', 4);

-- Black Gold, after 98's shape. 09-14 team A: Alpha a starter who played,
-- Bravo a substitute who did not. 09-15 team A: listed, but no report, so it
-- counts for nobody. 09-22: outside the week.
create function pg_temp.battle(key text, ended timestamptz)
returns void language sql as $$
  insert into public.black_money_battle_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, alliance_external_id,
     battle_ended_at, team_index, state, score, user_num, max_user_num)
  values ('00000000-0000-4000-8000-00000000a0b4', 'dragon.activity.info', 'test',
          'test:109:' || key, ended + interval '1 hour',
          '00000000-0000-4000-8000-000000000c01', 580, 580,
          'b1550000000000000000000000000109', ended, 1, 2, 1, 20, 20);
$$;
create function pg_temp.signup(key text, at timestamptz, uid bigint, state int)
returns void language sql as $$
  insert into public.black_money_signup_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, name, state, team_index)
  values ('00000000-0000-4000-8000-00000000a0b5', 'dragon.assign.player.info', 'test',
          'test:109:' || key, at, '00000000-0000-4000-8000-000000000c01', 580, 580,
          uid, 'P' || uid, state, 1);
$$;
create function pg_temp.score(key text, sent timestamptz, uid bigint)
returns void language sql as $$
  insert into public.black_money_score_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, name,
     alliance_external_id, side, win, reported_at, score)
  values ('00000000-0000-4000-8000-00000000a0b6', 'push.mail', 'test', 'test:109:' || key,
          sent + interval '1 minute', '00000000-0000-4000-8000-000000000c01', 580, 580,
          uid, 'P' || uid, 'b1550000000000000000000000000109', 0, 1, sent, 100);
$$;
select pg_temp.battle('bg1', '2026-09-14T21:50:00Z');
select pg_temp.battle('bg2', '2026-09-15T21:50:00Z');
select pg_temp.battle('bg3', '2026-09-22T21:50:00Z');
select pg_temp.signup('bs1', '2026-09-14T15:00:00Z', 9230000000000101, 1);
select pg_temp.signup('bs2', '2026-09-14T15:00:00Z', 9230000000000102, 2);
select pg_temp.signup('bs3', '2026-09-15T15:00:00Z', 9230000000000101, 1);
select pg_temp.signup('bs4', '2026-09-22T15:00:00Z', 9230000000000102, 1);
select pg_temp.score('bp1', '2026-09-14T21:54:00Z', 9230000000000101);
select pg_temp.score('bp3', '2026-09-22T21:54:00Z', 9230000000000101);

-- Typed by somebody else's alliance, written straight in. Nobody here may
-- see it, and it must not count as an event "held" here.
insert into public.event_attendance (alliance_id, kind, held_on, player_id, attended)
values ('00000000-0000-4000-8000-00000000a902', 'server_clash', '2026-09-16',
        '00000000-0000-4000-8000-00000000a101', true);

-- ----------------------------------------------------------- the refusals

select is(
  (select array_agg(kind order by sort_order) from public.attendance_event_kinds),
  array['capital_clash', 'server_clash', 'frankie', 'ice_pit', 'furnace_fury'],
  'the five uncaptured events are recordable, in report order');

select pg_temp.act_as('00000000-0000-4000-8000-00000000a302');
set local role authenticated;

select throws_ok(
  $$ select public.record_event_attendance('capital_clash', '2026-09-15',
       '[{"player_id":"00000000-0000-4000-8000-00000000a101","attended":true}]') $$,
  '42501', null, 'a member cannot record attendance');
select throws_ok(
  $$ insert into public.event_attendance (kind, held_on, player_id, attended)
     values ('capital_clash', '2026-09-15', '00000000-0000-4000-8000-00000000a101', true) $$,
  '42501', null, 'nor write the table directly');
select is(
  (select count(*)::int from public.event_attendance), 0,
  'a member does not see another alliance''s typed attendance');

select pg_temp.act_as('00000000-0000-4000-8000-00000000a301');
select is(
  (select count(*)::int from public.attendance_event_kinds), 0,
  'a viewer cannot read the event list');
select is(
  (select count(*)::int from public.member_participation(
     '2026-09-14T02:00:00Z', '2026-09-21T02:00:00Z')), 0,
  'and the report shows a viewer nobody');

reset role;
select is(
  (select count(*)::int from public.event_attendance
    where alliance_id is distinct from '00000000-0000-4000-8000-00000000a902'),
  0, 'and the refused calls wrote nothing');

-- -------------------------------------------------------------- recording

select pg_temp.act_as('00000000-0000-4000-8000-00000000a303');
set local role authenticated;

select throws_ok(
  $$ select public.record_event_attendance('alliance_boss', '2026-09-15', '[]') $$,
  '22023', null, 'an event that is not on the list is refused');
select throws_ok(
  $$ select public.record_event_attendance('frankie',
       ((now() at time zone 'UTC') + interval '2 days')::date, '[]') $$,
  '22023', null, 'a day that has not happened is refused');
select throws_ok(
  $$ select public.record_event_attendance('frankie', '2026-09-16',
       '[{"player_id":"00000000-0000-4000-8000-00000000a1ff","attended":true}]') $$,
  '23503', null, 'a player the database has never seen is refused');
select throws_ok(
  $$ select public.record_event_attendance('frankie', '2026-09-16',
       '[{"player_id":"00000000-0000-4000-8000-00000000a101","attended":true},
         {"player_id":"00000000-0000-4000-8000-00000000a101","attended":false}]') $$,
  '23505', null, 'one member twice in one call is refused');
select throws_ok(
  $$ select public.record_event_attendance('frankie', '2026-09-16', '{}') $$,
  '22023', null, 'entries that are not an array are refused');

select is(
  public.record_event_attendance('capital_clash', '2026-09-15',
    '[{"player_id":"00000000-0000-4000-8000-00000000a101","attended":true},
      {"player_id":"00000000-0000-4000-8000-00000000a102","attended":false}]'),
  2, 'an officer records Capital Clash for two members');
select is(
  public.record_event_attendance('frankie', '2026-09-16',
    '[{"player_id":"00000000-0000-4000-8000-00000000a101","attended":false}]'),
  1, 'and Frankie for one');
select is(
  public.record_event_attendance('frankie', '2026-09-16',
    '[{"player_id":"00000000-0000-4000-8000-00000000a101","attended":true}]'),
  1, 'recording a member again replaces their row');
select is(
  (select count(*)::int from public.event_attendance where kind = 'frankie'),
  1, 'rather than adding a second');
select is(
  (select attended from public.event_attendance where kind = 'frankie'),
  true, 'and the correction is what stands');
select is(
  (select alliance_id from public.event_attendance where kind = 'frankie'),
  '00000000-0000-4000-8000-00000000a901'::uuid,
  'filed under the alliance being viewed');
select is(
  (select entered_by from public.event_attendance where kind = 'frankie'),
  '00000000-0000-4000-8000-00000000a303'::uuid,
  'and under the officer who typed it');

-- Ice Pit ticked by mistake, then taken away.
select public.record_event_attendance('ice_pit', '2026-09-17',
  '[{"player_id":"00000000-0000-4000-8000-00000000a102","attended":true}]');
select is(
  public.record_event_attendance('ice_pit', '2026-09-17',
    '[{"player_id":"00000000-0000-4000-8000-00000000a102","attended":null}]'),
  1, 'a null takes a member''s row away');
select is(
  (select count(*)::int from public.event_attendance where kind = 'ice_pit'),
  0, 'and nothing of it is left');

-- ------------------------------------------------------------- the report
--
-- Read as a member: the report is security invoker, so this is the path the
-- dashboard takes.

select pg_temp.act_as('00000000-0000-4000-8000-00000000a302');

create temp table r on commit drop as
select * from public.member_participation('2026-09-14T02:00:00Z', '2026-09-21T02:00:00Z');
reset role;

select is(
  (select array_agg(current_name order by current_name) from r),
  array['Alpha', 'Bravo'],
  'one row per current member, and nobody else');

select is((select duel_days_read from r where current_name = 'Alpha'), 2,
  'the duel board was read on two days; a non-member''s reading reads nothing');
select is((select duel_days_on_board from r where current_name = 'Alpha'), 2,
  'Alpha is on both');
select is((select duel_days_scored from r where current_name = 'Alpha'), 1,
  'and scored on one: a reading of 0 is on the board, not a score');
select is((select duel_days_on_board from r where current_name = 'Bravo'), 1,
  'Bravo is on one of the two read days');
select is((select duel_days_scored from r where current_name = 'Bravo'), 1,
  'and scored on it');

select is((select duel_weeks_read from r where current_name = 'Bravo'), 1,
  'the weekly board was read in the week');
select is((select duel_total from r where current_name = 'Alpha'), 1000::bigint,
  'Alpha''s week is their newest reading inside it');
select is((select duel_weeks_on_board from r where current_name = 'Bravo'), 0,
  'a reading after the reset belongs to the next week');
select is((select duel_total from r where current_name = 'Bravo'), null::bigint,
  'so Bravo''s week is unread, not zero');

select is((select donation_weeks_on_board from r where current_name = 'Alpha'), 1,
  'a donation of 0 is on the board');
select is((select donation_weeks_scored from r where current_name = 'Alpha'), 0,
  'and is not a week scored');
select is((select donation_total from r where current_name = 'Bravo'), 40::bigint,
  'Bravo donated 40');

select is(
  (select array[black_gold_listed, black_gold_played, black_gold_starter_missed]
     from r where current_name = 'Alpha'),
  array[1, 1, 0],
  'Black Gold: Alpha listed once and played; the unreported battle and the one after the week do not count');
select is(
  (select array[black_gold_listed, black_gold_played, black_gold_substitute_missed]
     from r where current_name = 'Bravo'),
  array[1, 0, 1],
  'Bravo listed once as a substitute and missed it');

select is((select season_levels_gained from r where current_name = 'Alpha'), 3,
  'season buildings: levels gained count from the last level seen before the week');
select is((select season_levels_gained from r where current_name = 'Bravo'), 2,
  'and from the first level seen inside it, for a building first sighted there');

select is(
  (select typed_events -> 'capital_clash' from r where current_name = 'Alpha'),
  '{"held": 1, "attended": 1, "missed": 0}'::jsonb,
  'Capital Clash: Alpha recorded present');
select is(
  (select typed_events -> 'capital_clash' from r where current_name = 'Bravo'),
  '{"held": 1, "attended": 0, "missed": 1}'::jsonb,
  'Bravo recorded absent');
select is(
  (select typed_events -> 'frankie' from r where current_name = 'Bravo'),
  '{"held": 1, "attended": 0, "missed": 0}'::jsonb,
  'an event held that nobody ticked a member for reads as not recorded, not absent');
select ok(
  (select not (typed_events ? 'server_clash') from r where current_name = 'Alpha'),
  'another alliance''s Server Clash was not held here');

select is(
  (select count(*)::int from public.member_participation(
     '2026-09-21T02:00:00Z', '2026-09-14T02:00:00Z')),
  0, 'a range that ends before it starts returns nothing');
select is(
  (select count(*)::int from public.member_participation(
     '2026-01-01T02:00:00Z', '2026-09-14T02:00:00Z')),
  0, 'and so does one longer than 190 days');

select * from finish();
rollback;
