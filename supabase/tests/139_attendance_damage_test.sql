-- 0274: an optional damage on a manual attendance row, and the report's totals.
--
-- Week of Monday 2026-09-14. Alpha is ticked for Frankie on two days with
-- scores; Bravo is ticked with none. Furnace Fury is read from its board, and a
-- typed score has to beat the scanned one for the same day.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

delete from public.attendance_event_days;

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000b911', 580, 'ext-dmg', 'DamageTest', true, 2);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000b911"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000b111', 580, 9400000000000111, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000b112', 580, 9400000000000112, 'Bravo', 80, 29);

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000b0c1', 'al.rank', 'test',
       'test:139:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000b911', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000b111'::uuid, 9400000000000111::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000b112'::uuid, 9400000000000112::bigint, 'Bravo')
  ) as v(player_id, game_uid, name);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000b311', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dmg-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000b312', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dmg-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000b311', 'member', 'dmg member'),
  ('00000000-0000-4000-8000-00000000b312', 'officer', 'dmg officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Held days: Frankie on 09-15 and 09-16; Furnace Fury on 09-15 (read from its board).
insert into public.attendance_event_days (alliance_id, kind, held_on) values
  ('00000000-0000-4000-8000-00000000b911', 'frankie', '2026-09-15'),
  ('00000000-0000-4000-8000-00000000b911', 'frankie', '2026-09-16'),
  ('00000000-0000-4000-8000-00000000b911', 'furnace_fury', '2026-09-15');


-- Held day: server_clash on 09-15.
insert into public.attendance_event_days (alliance_id, kind, held_on) values
  ('00000000-0000-4000-8000-00000000b911', 'server_clash', '2026-09-15'),
  ('00000000-0000-4000-8000-00000000b911', 'server_clash', '2026-09-16');

select pg_temp.act_as('00000000-0000-4000-8000-00000000b311');
set local role authenticated;
select throws_ok(
  $$select public.record_event_attendance('server_clash', '2026-09-15',
      '[{"player_id":"00000000-0000-4000-8000-00000000b111","attended":true,"damage":10}]')$$,
  '42501', null, 'a member cannot record a damage');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000b312');
set local role authenticated;

select throws_ok(
  $$select public.record_event_attendance('server_clash', '2026-09-15',
      '[{"player_id":"00000000-0000-4000-8000-00000000b111","attended":true,"damage":-5}]')$$,
  '22023', null, 'a negative damage is refused');

select lives_ok(
  $$select public.record_event_attendance('server_clash', '2026-09-15', '[
      {"player_id":"00000000-0000-4000-8000-00000000b111","attended":true,"score":5000,"damage":173863980},
      {"player_id":"00000000-0000-4000-8000-00000000b112","attended":true}]')$$,
  'an officer records score and damage together, and a tick with neither');
select is((select damage from public.event_attendance
            where kind = 'server_clash' and held_on = '2026-09-15' and player_id = '00000000-0000-4000-8000-00000000b111'),
  173863980::bigint, 'the damage is stored');
select is((select score from public.event_attendance
            where kind = 'server_clash' and held_on = '2026-09-15' and player_id = '00000000-0000-4000-8000-00000000b111'),
  5000::bigint, 'next to the score, which is untouched by it');
select ok((select damage is null from public.event_attendance
            where kind = 'server_clash' and held_on = '2026-09-15' and player_id = '00000000-0000-4000-8000-00000000b112'),
  'a tick with no damage stores none, not zero');

-- Re-recording the score alone keeps the damage; the damage alone keeps the score.
select public.record_event_attendance('server_clash', '2026-09-15', '[
  {"player_id":"00000000-0000-4000-8000-00000000b111","attended":true,"score":6000}]');
select is((select damage from public.event_attendance
            where kind = 'server_clash' and held_on = '2026-09-15' and player_id = '00000000-0000-4000-8000-00000000b111'),
  173863980::bigint, 'correcting the score leaves the damage alone');

-- A second day.
select public.record_event_attendance('server_clash', '2026-09-16', '[
  {"player_id":"00000000-0000-4000-8000-00000000b111","attended":true,"damage":1000}]');

create temp table r on commit drop as
  select current_name, typed_events
    from public.member_participation('2026-09-14T02:00:00Z', '2026-09-21T02:00:00Z');
select is((select (typed_events -> 'server_clash' ->> 'damage')::bigint from r where current_name = 'Alpha'),
  173864980::bigint, 'Alpha''s damage is the total of both days');
select ok((select typed_events -> 'server_clash' ->> 'damage' is null from r where current_name = 'Bravo'),
  'Bravo, ticked with no damage, has no total (not 0)');

-- A null damage clears it.
select public.record_event_attendance('server_clash', '2026-09-16', '[
  {"player_id":"00000000-0000-4000-8000-00000000b111","attended":true,"damage":null}]');
select ok((select damage is null from public.event_attendance
            where kind = 'server_clash' and held_on = '2026-09-16' and player_id = '00000000-0000-4000-8000-00000000b111'),
  'a null damage clears it');

select * from finish();
rollback;
