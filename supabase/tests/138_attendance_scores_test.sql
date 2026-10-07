-- 0241: an optional score on a manual attendance row, and the report's totals.
--
-- Week of Monday 2026-09-14. Alpha is ticked for Frankie on two days with
-- scores; Bravo is ticked with none. Furnace Fury is read from its board, and a
-- typed score has to beat the scanned one for the same day.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

delete from public.attendance_event_days;

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000b901', 580, 'ext-scr', 'ScoreTest', true, 2);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000b901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000b101', 580, 9400000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000b102', 580, 9400000000000102, 'Bravo', 80, 29);

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000b0b1', 'al.rank', 'test',
       'test:138:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000b901', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000b101'::uuid, 9400000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000b102'::uuid, 9400000000000102::bigint, 'Bravo')
  ) as v(player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000b301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'scr-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000b302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'scr-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000b301', 'member', 'scr member'),
  ('00000000-0000-4000-8000-00000000b302', 'officer', 'scr officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Held days: Frankie on 09-15 and 09-16; Furnace Fury on 09-15 (read from its board).
insert into public.attendance_event_days (alliance_id, kind, held_on) values
  ('00000000-0000-4000-8000-00000000b901', 'frankie', '2026-09-15'),
  ('00000000-0000-4000-8000-00000000b901', 'frankie', '2026-09-16'),
  ('00000000-0000-4000-8000-00000000b901', 'furnace_fury', '2026-09-15');

-- Furnace Fury board, 09-15: Alpha read twice (the day's score is the highest),
-- Bravo once. Both fought.
insert into public.furnace_fury_scores
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid,
   alliance_id, alliance_external_id, held_on, score)
values
  ('00000000-0000-4000-8000-00000000b0b2', 'test.ff', 'test', 'test:138:ff1', '2026-09-15T10:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-00000000b101',
   9400000000000101, '00000000-0000-4000-8000-00000000b901', 'ext-scr', '2026-09-15', 300),
  ('00000000-0000-4000-8000-00000000b0b2', 'test.ff', 'test', 'test:138:ff2', '2026-09-15T20:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-00000000b101',
   9400000000000101, '00000000-0000-4000-8000-00000000b901', 'ext-scr', '2026-09-15', 500),
  ('00000000-0000-4000-8000-00000000b0b2', 'test.ff', 'test', 'test:138:ff3', '2026-09-15T10:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, '00000000-0000-4000-8000-00000000b102',
   9400000000000102, '00000000-0000-4000-8000-00000000b901', 'ext-scr', '2026-09-15', 40);

-- ------------------------------------------------------------- refusals

select pg_temp.act_as('00000000-0000-4000-8000-00000000b301');
set local role authenticated;
select throws_ok(
  $$select public.record_event_attendance('frankie', '2026-09-15',
      '[{"player_id":"00000000-0000-4000-8000-00000000b101","attended":true,"score":10}]')$$,
  '42501', null, 'a member cannot record a score');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000b302');
set local role authenticated;

select throws_ok(
  $$select public.record_event_attendance('frankie', '2026-09-15',
      '[{"player_id":"00000000-0000-4000-8000-00000000b101","attended":true,"score":-5}]')$$,
  '22023', null, 'a negative score is refused');
select throws_ok(
  $$select public.record_event_attendance('frankie', '2026-09-15',
      '[{"player_id":"00000000-0000-4000-8000-00000000b101","attended":true,"score":1.5}]')$$,
  '22023', null, 'a fractional score is refused');
select throws_ok(
  $$select public.record_event_attendance('frankie', '2026-09-15',
      '[{"player_id":"00000000-0000-4000-8000-00000000b101","attended":true,"score":"lots"}]')$$,
  '22023', null, 'a score that is not a number is refused');

-- ------------------------------------------------------------- recording

select lives_ok(
  $$select public.record_event_attendance('frankie', '2026-09-15', '[
      {"player_id":"00000000-0000-4000-8000-00000000b101","attended":true,"score":1200},
      {"player_id":"00000000-0000-4000-8000-00000000b102","attended":true}]')$$,
  'an officer records a tick with a score, and a tick without one');
select is((select score from public.event_attendance
            where kind = 'frankie' and held_on = '2026-09-15' and player_id = '00000000-0000-4000-8000-00000000b101'),
  1200::bigint, 'the score is stored');
select ok((select score is null from public.event_attendance
            where kind = 'frankie' and held_on = '2026-09-15' and player_id = '00000000-0000-4000-8000-00000000b102'),
  'and a tick with none stores none, not zero');

-- Correcting the tick without mentioning the score keeps it.
select public.record_event_attendance('frankie', '2026-09-15', '[
  {"player_id":"00000000-0000-4000-8000-00000000b101","attended":false}]');
select is((select score from public.event_attendance
            where kind = 'frankie' and held_on = '2026-09-15' and player_id = '00000000-0000-4000-8000-00000000b101'),
  1200::bigint, 'correcting a tick leaves its score alone');
select public.record_event_attendance('frankie', '2026-09-15', '[
  {"player_id":"00000000-0000-4000-8000-00000000b101","attended":true}]');

-- A second day, and a typed score over the scanned one.
select public.record_event_attendance('frankie', '2026-09-16', '[
  {"player_id":"00000000-0000-4000-8000-00000000b101","attended":true,"score":800}]');
select public.record_event_attendance('furnace_fury', '2026-09-15', '[
  {"player_id":"00000000-0000-4000-8000-00000000b101","attended":true,"score":900}]');

-- ------------------------------------------------------------ the report

create temp table r on commit drop as
  select current_name, typed_events
    from public.member_participation('2026-09-14T02:00:00Z', '2026-09-21T02:00:00Z');

select is((select (typed_events -> 'frankie' ->> 'score')::bigint from r where current_name = 'Alpha'),
  2000::bigint, 'Alpha''s Frankie total is the scores of both days');
select ok((select typed_events -> 'frankie' ->> 'score' is null from r where current_name = 'Bravo'),
  'Bravo, ticked with no score, has no total (not 0)');
select is((select (typed_events -> 'furnace_fury' ->> 'score')::bigint from r where current_name = 'Alpha'),
  900::bigint, 'a typed score beats the scanned one for the same day');
select is((select (typed_events -> 'furnace_fury' ->> 'score')::bigint from r where current_name = 'Bravo'),
  40::bigint, 'with nothing typed, the scanned score stands');

-- Clearing a score.
select public.record_event_attendance('frankie', '2026-09-16', '[
  {"player_id":"00000000-0000-4000-8000-00000000b101","attended":true,"score":null}]');
select ok((select score is null from public.event_attendance
            where kind = 'frankie' and held_on = '2026-09-16' and player_id = '00000000-0000-4000-8000-00000000b101'),
  'a null score clears it');
select public.record_event_attendance('frankie', '2026-09-16', '[
  {"player_id":"00000000-0000-4000-8000-00000000b101","attended":null,"score":5}]');
select is((select count(*) from public.event_attendance
            where kind = 'frankie' and held_on = '2026-09-16'), 0::bigint,
  'clearing the tick removes the row and its score with it');

select * from finish();
rollback;
