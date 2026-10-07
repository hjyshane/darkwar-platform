-- 0240: events added from settings, and an event day declared from the recorder.
--
-- The refusals come first (§20.2): a kind written by somebody who may not, or a
-- held day declared in another alliance, would put a column or a count in front
-- of people nobody authorised it for.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- The held days earlier migrations seed would muddy the counts.
delete from public.attendance_event_days;

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-00000000f901', 580, 'ext-evt', 'EventTest', true, 1),
  ('00000000-0000-4000-8000-00000000f902', 580, 'ext-evt2', 'OtherEvent', false, 0);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000f901"}');
select public.resolve_own_alliance();

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'evt-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'evt-officer@test.invalid'),
  ('00000000-0000-4000-8000-00000000f303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'evt-admin@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f301', 'member', 'evt member'),
  ('00000000-0000-4000-8000-00000000f302', 'officer', 'evt officer'),
  ('00000000-0000-4000-8000-00000000f303', 'admin', 'evt admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- A day declared in ANOTHER alliance, written as the owner.
insert into public.attendance_event_days (alliance_id, kind, held_on)
values ('00000000-0000-4000-8000-00000000f902', 'frankie', '2026-09-20');

-- ------------------------------------------------------------- refusals

select pg_temp.act_as('00000000-0000-4000-8000-00000000f301');
set local role authenticated;
select throws_ok(
  $$select public.save_event_kind('new_event', 'New event', 'event')$$,
  '42501', null, 'a member cannot add an event');
select throws_ok(
  $$select public.declare_event_day('frankie', '2026-09-21')$$,
  '42501', null, 'a member cannot declare a day');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');
set local role authenticated;
select throws_ok(
  $$select public.save_event_kind('new_event', 'New event', 'event')$$,
  '42501', null, 'an officer cannot add an event: that is catalogue.write');

reset role;
select ok(not has_function_privilege('anon',
  'public.save_event_kind(text, text, text, int, boolean)', 'execute'),
  'anon cannot add an event');
select ok(not has_function_privilege('anon',
  'public.declare_event_day(text, date, text, boolean)', 'execute'),
  'anon cannot declare a day');

-- ----------------------------------------------------------- the kinds

select pg_temp.act_as('00000000-0000-4000-8000-00000000f303');
set local role authenticated;
select lives_ok(
  $$select public.save_event_kind('arena_cup', 'Arena Cup', 'event')$$,
  'an admin adds an event');
select is((select label from public.attendance_event_kinds where kind = 'arena_cup'), 'Arena Cup',
  'it is stored');
select is((select captured from public.attendance_event_kinds where kind = 'arena_cup'), false,
  'a form-made event is never marked captured');
select ok((select sort_order from public.attendance_event_kinds where kind = 'arena_cup')
          > (select max(sort_order) from public.attendance_event_kinds where kind <> 'arena_cup'),
  'with no position given it goes to the end');

select throws_ok(
  $$select public.save_event_kind('Bad Key', 'x', 'event')$$,
  '22023', null, 'a key with spaces or capitals is refused');
select throws_ok(
  $$select public.save_event_kind('arena_cup', '   ', 'event')$$,
  '22023', null, 'a blank name is refused');
select throws_ok(
  $$select public.save_event_kind('arena_cup', 'Arena Cup', 'chat')$$,
  '22023', null, 'an unknown tab is refused');

select lives_ok(
  $$select public.save_event_kind('frankie', 'Frankie!', 'season')$$,
  'editing an existing event works');
select is(
  (select captured from public.attendance_event_kinds where kind = 'furnace_fury'), true,
  'and the captured flag of a collector-written event is untouched');

select throws_ok(
  $$select public.save_event_kind('arena_cup', 'Arena Cup', null)$$,
  '22023', null, 'a missing tab is a clean refusal, not a not-null error');
select lives_ok(
  $$select public.save_event_kind('arena_cup', 'Arena Cup', 'event', null, true)$$,
  'an event can be archived');
select public.save_event_kind('arena_cup', 'Arena Cup 2', 'event');
select is((select archived from public.attendance_event_kinds where kind = 'arena_cup'), true,
  'and an edit that does not mention archived leaves it archived');
select public.save_event_kind('arena_cup', 'Arena Cup', 'event', null, false);

-- ------------------------------------------------------------ held days

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');
set local role authenticated;
select lives_ok(
  $$select public.declare_event_day('arena_cup', '2026-09-21', 'Round of 16')$$,
  'an officer declares a held day');
select is((select count(*) from public.attendance_event_days where kind = 'arena_cup'), 1::bigint,
  'one row');
select lives_ok(
  $$select public.declare_event_day('arena_cup', '2026-09-21', 'Final')$$,
  'declaring it again');
select is((select note from public.attendance_event_days where kind = 'arena_cup'), 'Final',
  'updates the note rather than adding a second row');
select throws_ok(
  $$select public.declare_event_day('arena_cup', '2999-01-01')$$,
  '22023', null, 'a day that has not happened is refused');

-- Taking back another alliance's day must not work, and must not be seen.
select public.declare_event_day('frankie', '2026-09-20', null, false);
reset role;
select is((select count(*) from public.attendance_event_days
            where kind = 'frankie' and alliance_id = '00000000-0000-4000-8000-00000000f902'),
  1::bigint, 'another alliance''s declared day is not removed');

select * from finish();
rollback;
