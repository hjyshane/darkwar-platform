-- 0325: the game calendar becomes captured entries on the boards that watch an
-- activity: right times per stage, moved in place, never deleted, only for own
-- alliances, never beyond 14 days, a hidden entry stays hidden.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- ---------------------------------------------------------------- set-up

update public.alliances set is_own = false where is_own;
delete from public.app_settings where key = 'own_alliance';
insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-000000325c01', 'calendar-alarm-test');

-- Two own alliances get the three calendar boards from the 0322 trigger.
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-0000000325a1', 580, 'ext-cal-a', 'CalA', true, 2),
  ('00000000-0000-4000-8000-0000000325a2', 580, 'ext-cal-b', 'CalB', true, 2),
  ('00000000-0000-4000-8000-0000000325a3', 580, 'ext-cal-c', 'CalC', false, 2);

-- Whole seconds, so a stored time compares equal to the epoch we sent.
create function pg_temp.t0() returns timestamptz language sql as $$
  select date_trunc('second', now())
$$;

create function pg_temp.ms(p timestamptz) returns bigint language sql as $$
  select (floor(extract(epoch from date_trunc('second', p))) * 1000)::bigint
$$;

create function pg_temp.snap(p_key text, p_at timestamptz, p_events jsonb)
returns void language sql as $$
  insert into public.event_schedule_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, events)
  values (gen_random_uuid(), 'init', '1.0.0', 'cal325:' || p_key, p_at,
          '00000000-0000-4000-8000-000000325c01', 580, 580, p_events)
$$;

-- Black Gold: sign-up +1d..stop, roster stop..+5d, battle ending +6d.
create function pg_temp.bg(p_stop_signup timestamptz) returns jsonb language sql as $$
  select jsonb_build_object('id', '80002',
    'startTime', pg_temp.ms(pg_temp.t0() + interval '1 day'),
    'endTime', pg_temp.ms(pg_temp.t0() + interval '8 days'),
    'startSignUpTime', pg_temp.ms(pg_temp.t0() + interval '1 day'),
    'stopSignUpTime', pg_temp.ms(p_stop_signup),
    'battleOpenTime', pg_temp.ms(pg_temp.t0() + interval '5 days'),
    'battleEndTime', pg_temp.ms(pg_temp.t0() + interval '6 days'))
$$;

create function pg_temp.clash() returns jsonb language sql as $$
  select jsonb_build_object('id', '111001',
    'startTime', pg_temp.ms(pg_temp.t0() + interval '2 days'),
    'endTime', pg_temp.ms(pg_temp.t0() + interval '2 days 1 hour'))
$$;

create function pg_temp.times(p_cat text) returns text language sql as $$
  select string_agg(pg_temp.ms(e.starts_at) || '→' || pg_temp.ms(e.ends_at), ',')
    from public.schedule_events e
   where e.alliance_id = '00000000-0000-4000-8000-0000000325a1'
     and e.category = p_cat
$$;

select pg_temp.snap('one', now() + interval '1 hour',
  jsonb_build_array(pg_temp.clash(), pg_temp.bg(pg_temp.t0() + interval '3 days')));

-- ------------------------------------------------------------------ tests

select is(internal.sync_calendar_alarms(), 6, 'three boards × two own alliances');

select is(pg_temp.times('game_black_gold_signup'),
  pg_temp.ms(pg_temp.t0() + interval '1 day') || '→' || pg_temp.ms(pg_temp.t0() + interval '3 days'),
  'sign-up window');

select is(pg_temp.times('game_black_gold_roster'),
  pg_temp.ms(pg_temp.t0() + interval '3 days') || '→' || pg_temp.ms(pg_temp.t0() + interval '5 days'),
  'roster window');

select is(internal.sync_calendar_alarms(), 0, 're-reading writes nothing');

-- An officer's message on the sign-up entry, then a newer reading moves its stop.
update public.schedule_events set alarm_message = 'keep me'
 where alliance_id = '00000000-0000-4000-8000-0000000325a1'
   and category = 'game_black_gold_signup';
select pg_temp.snap('two', now() + interval '2 hours',
  jsonb_build_array(pg_temp.clash(), pg_temp.bg(pg_temp.t0() + interval '4 days')));
select internal.sync_calendar_alarms();

select is((select case when pg_temp.ms(ends_at) = pg_temp.ms(pg_temp.t0() + interval '4 days')
                       then 'moved' else 'stale' end
             from public.schedule_events
            where alliance_id = '00000000-0000-4000-8000-0000000325a1'
              and category = 'game_black_gold_signup'),
  'moved', 'a newer reading moves the entry in place');

select is((select alarm_message from public.schedule_events
            where alliance_id = '00000000-0000-4000-8000-0000000325a1'
              and category = 'game_black_gold_signup'),
  'keep me', 'and keeps the officer''s message');

-- A reading without Black Gold deletes nothing.
select pg_temp.snap('three', now() + interval '3 hours', jsonb_build_array(pg_temp.clash()));
select internal.sync_calendar_alarms();
select is((select count(*)::int from public.schedule_events
            where source = 'captured' and source_key like 'cal:%'
              and alliance_id in ('00000000-0000-4000-8000-0000000325a1',
                                  '00000000-0000-4000-8000-0000000325a2')),
  6, 'missing from a reading deletes nothing');

-- A Capital Clash 20 days out is not filed yet.
select pg_temp.snap('four', now() + interval '4 hours',
  jsonb_build_array(jsonb_build_object('id', '111001',
    'startTime', pg_temp.ms(pg_temp.t0() + interval '20 days'),
    'endTime', pg_temp.ms(pg_temp.t0() + interval '20 days 1 hour'))));
select internal.sync_calendar_alarms();
select is((select count(*)::int from public.schedule_events
            where source_key like 'cal:111001:main:%'
              and starts_at > now() + interval '14 days'),
  0, 'nothing more than 14 days ahead');

-- A hidden entry stays hidden through a re-sync that moves it.
update public.schedule_events set hidden = true
 where alliance_id = '00000000-0000-4000-8000-0000000325a1'
   and category = 'game_black_gold_signup';
select pg_temp.snap('five', now() + interval '5 hours',
  jsonb_build_array(pg_temp.clash(), pg_temp.bg(pg_temp.t0() + interval '3 days 12 hours')));
select internal.sync_calendar_alarms();
select is((select hidden from public.schedule_events
            where alliance_id = '00000000-0000-4000-8000-0000000325a1'
              and category = 'game_black_gold_signup'),
  true, 'a hidden entry stays hidden');

select is((select count(*)::int from public.schedule_events
            where alliance_id = '00000000-0000-4000-8000-0000000325a3'),
  0, 'other alliances get nothing');

-- A malformed time is skipped, not fatal.
select pg_temp.snap('six', now() + interval '6 hours',
  jsonb_build_array(jsonb_set(pg_temp.bg(pg_temp.t0() + interval '3 days'),
                              '{startSignUpTime}', '"soon"')));
select lives_ok($$ select internal.sync_calendar_alarms() $$,
  'a malformed time never fails the run');

select * from finish();
rollback;
