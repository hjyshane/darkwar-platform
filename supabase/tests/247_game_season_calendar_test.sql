-- 0245: the game's season calendar creates and fills seasons, and never
-- overwrites what a person set.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000e1001', 'season-calendar-test');

-- The migration's own seed ran: Season 4 exists, announced for 11-09.
select is((select starts_at from public.seasons where season_id = 4),
  timestamptz '2026-11-09 02:00:00+00', 'the announced season exists from the migration');
select is((select name from public.seasons where season_id = 4), 'Season 4',
  'named by number, buildings are named by hand later');

-- A person renames Season 5 and dates it; the game then names it too.
insert into public.seasons (season_id, name, starts_at, ends_at)
values (5, 'Winter', '2027-02-01 02:00+00', null);

insert into public.game_season_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, stage, starts_at, next_stage, next_starts_at,
   settle_at)
values
  (gen_random_uuid(), 'init', '1.0.0', 'e1-test:1', '2026-12-01 00:00+00',
   '00000000-0000-4000-8000-0000000e1001', 580,
   3, '2026-11-09 02:00+00', 4, '2027-02-15 02:00+00', '2027-01-04 02:00+00');

select is((select ends_at from public.seasons where season_id = 4),
  timestamptz '2027-01-04 02:00:00+00', 'the current stage gets its settle date as its end');
select is((select starts_at from public.seasons where season_id = 5),
  timestamptz '2027-02-01 02:00:00+00', 'a start somebody set is not overwritten');
select is((select name from public.seasons where season_id = 5), 'Winter',
  'nor a name');
select is((select count(*)::int from public.seasons where season_id = 5), 1,
  'and the next stage is not created twice');

-- A calendar whose settle date does not come after the start leaves the end
-- empty, and the snapshot is still stored.
insert into public.game_season_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, stage, starts_at, settle_at)
values
  (gen_random_uuid(), 'init', '1.0.0', 'e1-test:2', '2027-03-01 00:00+00',
   '00000000-0000-4000-8000-0000000e1001', 580,
   8, '2027-03-01 02:00+00', '2027-02-01 02:00+00');
select is((select count(*)::int from public.game_season_snapshots where idempotency_key = 'e1-test:2'), 1,
  'a calendar that disagrees with itself is still stored');
select is((select ends_at from public.seasons where season_id = 9), null::timestamptz,
  'and its end stays empty rather than violating the check');

-- Members read the calendar; nobody but the collector writes it.
set local role authenticated;
select throws_ok(
  $$insert into public.game_season_snapshots
      (observation_id, source_command, parser_version, idempotency_key, captured_at,
       collector_id, collected_from_server_id, stage, starts_at)
    values (gen_random_uuid(), 'init', '1', 'e1-test:3', now(),
      '00000000-0000-4000-8000-0000000e1001', 580, 1, now())$$,
  '42501', null, 'a signed-in user cannot write it');
reset role;

select * from finish();
rollback;
