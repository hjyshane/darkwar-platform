-- 0326: a Siege / Frankie / Black Gold pick that moves to another server day
-- MOVES its entry: same id, so the officer's alarm message, turned-off steps and
-- send history stay. Captured entries no longer carry 'Read from the game.'.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a2001', 'event-move-test');
insert into public.alliances (alliance_id, server_id, external_id, current_name) values
  ('00000000-0000-4000-8000-0000000a2a01', 580, 'ext-em-ours', 'OursEM');
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a2b01', 580, 9310000000000801, 'Ours char');
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, kills)
values (gen_random_uuid(), 'al.rank', 't', 'em-test:roster', now() - interval '1 day',
        '00000000-0000-4000-8000-0000000a2001', 580,
        '00000000-0000-4000-8000-0000000a2a01', 580,
        '00000000-0000-4000-8000-0000000a2b01', 9310000000000801, 'Ours char', 3, 30, 1, 1);
insert into public.account_state_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid)
values (gen_random_uuid(), 'init', 't', 'em-test:login', now() - interval '1 minute',
        '00000000-0000-4000-8000-0000000a2001', 580, 580,
        '00000000-0000-4000-8000-0000000a2b01', 9310000000000801);

create function pg_temp.d(n int, hh int default 14) returns timestamptz language sql as $$
  select (((now() at time zone 'UTC')::date + n) + make_interval(hours => hh)) at time zone 'UTC';
$$;

create function pg_temp.put(p_key text, p_event text, p_slot int, p_start timestamptz,
                            p_at timestamptz default now())
returns void language sql as $$
  insert into public.alliance_event_times
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, event_key, slot, starts_at, ends_at)
  values (gen_random_uuid(), 'test', 't', p_key, p_at,
          '00000000-0000-4000-8000-0000000a2001', 580, p_event, p_slot, p_start, null);
$$;

-- A siege on day 1 and a Frankie on day 2; the siege gets an officer's message
-- and a turned-off step, the Frankie is hidden.
select pg_temp.put('em:siege:1', 'zombie_siege', 1, pg_temp.d(1));
select pg_temp.put('em:frankie:1', 'bio_mutant', 1, pg_temp.d(2));

create temp table _em as
select (select schedule_event_id from public.schedule_events where source_key like 'zombie_siege:1:%') as siege_id,
       (select schedule_event_id from public.schedule_events where source_key like 'bio_mutant:1:%') as frankie_id;

select is((select body from public.schedule_events where schedule_event_id = (select siege_id from _em)),
  null, 'captured entries carry no "Read from the game."');

update public.schedule_events set alarm_message = 'Bring shields'
 where schedule_event_id = (select siege_id from _em);
update public.schedule_reminders set enabled = false
 where reminder_id = (select reminder_id from public.schedule_reminders
                       where schedule_event_id = (select siege_id from _em)
                       order by minutes_before limit 1);
update public.schedule_events set hidden = true
 where schedule_event_id = (select frankie_id from _em);

select cmp_ok((select count(*)::int from public.schedule_reminders
                where schedule_event_id = (select siege_id from _em)), '>', 1,
  'precondition: the siege entry has several steps');

-- Both picks move to another server day while still ahead.
select pg_temp.put('em:siege:2', 'zombie_siege', 1, pg_temp.d(4), now() + interval '1 minute');
select pg_temp.put('em:frankie:2', 'bio_mutant', 1, pg_temp.d(5), now() + interval '1 minute');

select is((select schedule_event_id from public.schedule_events where source_key like 'zombie_siege:1:%'),
  (select siege_id from _em), 'a pick moved to another day keeps its entry');
select is((select count(*)::int from public.schedule_events where source_key like 'zombie_siege:1:%'),
  1, 'and there is still just one');
select is((select alarm_message from public.schedule_events where schedule_event_id = (select siege_id from _em)),
  'Bring shields', 'and its message');
select is((select count(*)::int from public.schedule_reminders
            where schedule_event_id = (select siege_id from _em) and not enabled),
  1, 'and its turned-off step');
select is((select starts_at from public.schedule_events where schedule_event_id = (select siege_id from _em)),
  pg_temp.d(4), 'at the new time');
select is((select source_key from public.schedule_events where schedule_event_id = (select siege_id from _em)),
  'zombie_siege:1:' || to_char((pg_temp.d(4) - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD'),
  'under the new day''s key');
select is((select hidden from public.schedule_events where schedule_event_id = (select frankie_id from _em)),
  true, 'a hidden pick stays hidden when it moves');

select * from finish();
rollback;
