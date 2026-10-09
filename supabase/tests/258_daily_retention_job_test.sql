-- 0258: the daily pass purges, logs, flags "behind", and is on the clock.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cf58', 'daily test', 'offline', 'test')
on conflict do nothing;

insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-0000000058bb'::uuid, 581, 'bbbb0000000000000000000000000058', 'THEIRS', false, 1);

-- Three expired stranger rows (presence_redacted true keeps the alliance not-own).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, name,
   presence_redacted)
select gen_random_uuid(), 'al.rank', 'test', 'test:daily:' || g, now() - interval '40 days',
  '00000000-0000-4000-8000-00000000cf58', 580, '00000000-0000-4000-8000-0000000058bb',
  581, 958000000 + g, 'S' || g, true
from generate_series(1, 3) g;

-- The cron.job row is not asserted: the local stub has no cron.job table.
select has_function('internal', 'retention_daily', array['integer'], 'the daily pass exists');

select is((select count(*) from internal.retention_runs), 0::bigint, 'no runs yet');

select internal.retention_daily();

select is(
  (select (deleted ->> 'alliance_member_snapshots')::bigint from internal.retention_runs),
  3::bigint, 'the run removed the three expired rows and logged them');

select is(
  (select count(*) from public.alliance_member_snapshots where idempotency_key like 'test:daily:%'),
  0::bigint, 'and they are gone');

select is((select behind from internal.retention_runs), false,
  'ran out of work before running out of rounds, so not behind');

select ok((select db_bytes > 0 from internal.retention_runs), 'database size is recorded');

-- A run that is cut off by the round cap says so.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, name,
   presence_redacted)
values (gen_random_uuid(), 'al.rank', 'test', 'test:daily:late', now() - interval '40 days',
  '00000000-0000-4000-8000-00000000cf58', 580, '00000000-0000-4000-8000-0000000058bb',
  581, 958999999, 'late', true);

select internal.retention_daily(1);
select is((select behind from internal.retention_runs order by run_id desc limit 1), true,
  'a pass cut off by max batches reports behind');

set local role authenticated;
select throws_ok($$ select internal.retention_daily() $$, '42501', null,
  'not callable by signed-in users');
reset role;

select * from finish();
rollback;
