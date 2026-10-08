-- 0249: the alliance's own times for the siege, Frankie and Black Gold are put
-- on its schedule board - on the right alliance, as `captured` entries, without
-- touching what an officer changed and without adding a reminder.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a1001', 'event-times-test');
insert into public.alliances (alliance_id, server_id, external_id, current_name) values
  ('00000000-0000-4000-8000-0000000a1a01', 580, 'ext-et-ours', 'OursET'),
  ('00000000-0000-4000-8000-0000000a1a02', 580, 'ext-et-theirs', 'TheirsET');
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a1b01', 580, 9310000000000701, 'Ours char');

-- The account that logged in: ours, per its newest roster row.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, kills)
values (gen_random_uuid(), 'al.rank', 't', 'et-test:roster', now() - interval '1 day',
        '00000000-0000-4000-8000-0000000a1001', 580,
        '00000000-0000-4000-8000-0000000a1a01', 580,
        '00000000-0000-4000-8000-0000000a1b01', 9310000000000701, 'Ours char', 3, 30, 1, 1);
insert into public.account_state_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid)
values (gen_random_uuid(), 'init', 't', 'et-test:login', now() - interval '1 minute',
        '00000000-0000-4000-8000-0000000a1001', 580, 580,
        '00000000-0000-4000-8000-0000000a1b01', 9310000000000701);

-- UTC 14:00 on day n from today is 12:00 server time: mid-day, so adding an hour
-- or two cannot cross a server day whenever the test runs.
create function pg_temp.d(n int, hh int default 14) returns timestamptz language sql as $$
  select (((now() at time zone 'UTC')::date + n) + make_interval(hours => hh)) at time zone 'UTC';
$$;

-- A siege, Frankie's two battles, and Black Gold team B.
create function pg_temp.put(p_key text, p_event text, p_slot int, p_start timestamptz,
                            p_end timestamptz default null, p_alliance uuid default null,
                            p_at timestamptz default now())
returns void language sql as $$
  insert into public.alliance_event_times
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, event_key, slot, starts_at, ends_at, alliance_id)
  values (gen_random_uuid(), 'test', 't', p_key, p_at,
          '00000000-0000-4000-8000-0000000a1001', 580, p_event, p_slot, p_start, p_end, p_alliance);
$$;

select pg_temp.put('et:siege:1', 'zombie_siege', 1, pg_temp.d(1));
select pg_temp.put('et:frankie:1', 'bio_mutant', 1, pg_temp.d(2, 4), pg_temp.d(2, 5));
select pg_temp.put('et:frankie:2', 'bio_mutant', 2, pg_temp.d(2, 15));
select pg_temp.put('et:bg:2', 'black_gold', 2, pg_temp.d(3, 12), pg_temp.d(3, 13),
                   '00000000-0000-4000-8000-0000000a1a02');

select is((select alliance_id from public.alliance_event_times where idempotency_key = 'et:siege:1'),
  '00000000-0000-4000-8000-0000000a1a01'::uuid,
  'the siege has no alliance in its response: it is the one that logged in');
select is((select count(*)::int from public.schedule_events
            where alliance_id = '00000000-0000-4000-8000-0000000a1a01' and source = 'captured'),
  3, 'the siege and both Frankie battles are on our board');
select is((select count(*)::int from public.schedule_events
            where alliance_id = '00000000-0000-4000-8000-0000000a1a02' and source = 'captured'),
  1, 'Black Gold went to the alliance its response named');
select is((select title from public.schedule_events where source_key like 'black_gold:2:%'),
  'Black Gold, team B', 'team 2 is team B');
select is((select title from public.schedule_events where source_key like 'bio_mutant:2:%'),
  'Frankie 2', 'and Frankie''s battles are numbered');
select is((select count(*)::int from public.schedule_categories
            where alliance_id = '00000000-0000-4000-8000-0000000a1a01'
              and category in ('game_zombie_siege', 'game_bio_mutant') and channel is null),
  2, 'each event gets a board of its own, with no Discord channel');
select is((select count(*)::int from public.schedule_reminders r
            join public.schedule_events e using (schedule_event_id) where e.source = 'captured'),
  0, 'and no reminder: that stays a decision for an officer');

-- The same pick seen again, a little later: still one entry.
select pg_temp.put('et:siege:1b', 'zombie_siege', 1, pg_temp.d(1), null, null,
                   now() + interval '1 minute');
select is((select count(*)::int from public.schedule_events where source_key like 'zombie_siege:1:%'),
  1, 'the same day and slot is one entry');

-- An officer retitles it; the game then moves it an hour later the same day.
update public.schedule_events set title = 'SIEGE!!' where source_key like 'zombie_siege:1:%';
select pg_temp.put('et:siege:1c', 'zombie_siege', 1, pg_temp.d(1, 15), null, null,
                   now() + interval '2 minutes');
select is((select title from public.schedule_events where source_key like 'zombie_siege:1:%'),
  'SIEGE!!', 'a moved time keeps the officer''s title');
select is((select starts_at from public.schedule_events where source_key like 'zombie_siege:1:%'),
  (select starts_at from public.alliance_event_times where idempotency_key = 'et:siege:1c'),
  'and takes the new time');

-- An older reading arriving late does not roll the time back.
select pg_temp.put('et:siege:old', 'zombie_siege', 1, pg_temp.d(1, 16),
                   null, '00000000-0000-4000-8000-0000000a1a01', now() - interval '1 hour');
select is((select starts_at from public.schedule_events where source_key like 'zombie_siege:1:%'),
  (select starts_at from public.alliance_event_times where idempotency_key = 'et:siege:1c'),
  'a reading older than the entry''s own is not applied');

-- The pick moves to another day while still ahead: the old entry goes.
select pg_temp.put('et:siege:next', 'zombie_siege', 1, pg_temp.d(4), null, null,
                   now() + interval '3 minutes');
select is((select count(*)::int from public.schedule_events where source_key like 'zombie_siege:1:%'),
  1, 'moving the siege to another day replaces the entry rather than adding one');

-- Nobody logged in lately: stored, but no entry on a guessed board.
select pg_temp.put('et:siege:nobody', 'zombie_siege', 1, pg_temp.d(9), null, null,
                   now() + interval '1 day');
select is((select alliance_id from public.alliance_event_times where idempotency_key = 'et:siege:nobody'),
  null::uuid, 'with no login in the last ten minutes the alliance stays unknown');

select * from finish();
rollback;
