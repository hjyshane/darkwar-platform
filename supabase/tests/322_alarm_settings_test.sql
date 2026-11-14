-- 0322: alarm settings on boards, entries, reminders and the outbox.
--
-- A board says how its entries speak (steps before the start, an alarm when a
-- window opens, steps before it closes); an entry gets those steps copied onto
-- it as reminder rows the moment it is filed. The refusals matter as much as
-- the defaults: a member must not be able to make the bot speak.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

-- ---------------------------------------------------------------- set-up

update public.alliances set is_own = false where is_own;
delete from public.app_settings where key = 'own_alliance';
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-0000000322a1', 580, 'ext-alarm', 'AlarmTest', true, 2);
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-0000000322a1"}');
select public.resolve_own_alliance();

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000322b1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alarm-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000322b2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alarm-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000322b1', 'officer', 'alarm officer'),
  ('00000000-0000-4000-8000-0000000322b2', 'member', 'alarm member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.schedule_categories (alliance_id, category, label)
values ('00000000-0000-4000-8000-0000000322a1', 't_board', 'Point board');
insert into public.schedule_categories (alliance_id, category, label, kind, start_reminders)
values ('00000000-0000-4000-8000-0000000322a1', 't_window', 'Window board', 'window', '{}');

insert into public.schedule_events (schedule_event_id, alliance_id, title, category, starts_at, ends_at)
values
  ('00000000-0000-4000-8000-0000000322c1', '00000000-0000-4000-8000-0000000322a1',
   'point entry', 't_board', now() + interval '2 days', null),
  ('00000000-0000-4000-8000-0000000322c2', '00000000-0000-4000-8000-0000000322a1',
   'window entry', 't_window', now() + interval '2 days', now() + interval '3 days');

-- ------------------------------------------------------------- the defaults

select is((select kind || ':' || start_reminders::text from public.schedule_categories
            where category = 't_board'),
  'point:{720,60,5}', 'a new board defaults to point, 12h/1h/5m');

select is((select count(*)::int from public.schedule_categories
            where alliance_id = '00000000-0000-4000-8000-0000000322a1'
              and category in ('game_capital_clash', 'game_black_gold_signup',
                               'game_black_gold_roster')),
  3, 'own alliances get the three calendar boards');

select is((select array_agg(minutes_before order by minutes_before desc)
             from public.schedule_reminders
            where schedule_event_id = '00000000-0000-4000-8000-0000000322c1'),
  '{720,60,5}'::int[], 'a point entry gets every step');

select is((select array_agg(anchor || ':' || minutes_before order by anchor desc, minutes_before desc)
             from public.schedule_reminders
            where schedule_event_id = '00000000-0000-4000-8000-0000000322c2'),
  '{start:0,end:720,end:60,end:5}'::text[], 'a window entry gets open + close steps');

select is((select count(*)::int from public.schedule_categories
            where alliance_id = '00000000-0000-4000-8000-0000000322a1'
              and category = 'game_capital_clash'
              and kind = 'point' and activity_id = '111001' and activity_stage = 'main'),
  1, 'Capital Clash is a point board on activity 111001');

select is((select count(*)::int from public.schedule_categories
            where alliance_id = '00000000-0000-4000-8000-0000000322a1'
              and kind = 'window' and activity_id = '80002' and start_reminders = '{}'
              and activity_stage in ('signup', 'roster')),
  2, 'Black Gold sign-up and roster are window boards on 80002');

select is((select internal.seed_calendar_boards('00000000-0000-4000-8000-0000000322a1')),
  0, 'seeding the boards twice adds nothing');

-- ----------------------------------------------------------- the constraints

select throws_ok($$ insert into public.schedule_reminders (schedule_event_id)
    values ('00000000-0000-4000-8000-0000000322c1') $$,
  '23514', null, 'a reminder needs minutes_before or send_at');

select throws_ok($$ insert into public.schedule_reminders (schedule_event_id, minutes_before, send_at)
    values ('00000000-0000-4000-8000-0000000322c1', 5, now()) $$,
  '23514', null, 'not both');

select throws_ok($$ update public.schedule_categories set ping_role_id = 'everyone'
    where category = 't_board' $$,
  '23514', null, 'a ping role is a role ID');

select lives_ok($$ update public.schedule_categories set ping_role_id = '123456789012345678'
    where category = 't_board' $$,
  'an 18-digit role ID is accepted');

-- ------------------------------------------------------------- the refusals

select pg_temp.act_as('00000000-0000-4000-8000-0000000322b2');
set local role authenticated;

select is_empty($$ update public.schedule_categories set ping_role_id = '123456789012345679'
    where category = 't_board' returning 1 $$,
  'a member cannot change a board');

select throws_ok($$ insert into public.schedule_reminders (schedule_event_id, send_at)
    values ('00000000-0000-4000-8000-0000000322c1', now()) $$,
  '42501', null, 'a member cannot send now');

select is_empty($$ update public.schedule_events set alarm_message = 'x'
    where schedule_event_id = '00000000-0000-4000-8000-0000000322c1' returning 1 $$,
  'a member cannot write an alarm message');

reset role;

-- An officer can: the same statements, with the capability.
select pg_temp.act_as('00000000-0000-4000-8000-0000000322b1');
set local role authenticated;

select lives_ok($$ insert into public.schedule_reminders (schedule_event_id, send_at)
    values ('00000000-0000-4000-8000-0000000322c1', now()) $$,
  'an officer can send now');

reset role;

select * from finish();
rollback;
