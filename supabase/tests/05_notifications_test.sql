-- S9: snapshot inserts must emit exactly one notification per statement.
-- Seed data already fired the triggers, so assertions use deltas and the
-- newest row, never absolute counts.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

create temp table _before as
  select count(*) as n from public.data_change_notifications;

insert into public.arena_matches
  (observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id,
   server_id, week_start, game_uid)
select
  '00000000-0000-4000-8000-00000000dd10', 'user.get.arena.info', 'test',
  'test:notify:' || i, '2026-07-27T12:00:00Z',
  '00000000-0000-4000-8000-000000000c01', 580,
  580, public.reset_week_start('2026-07-27T12:00:00Z'::timestamptz),
  58000000 + i
from generate_series(1, 5) as i;

select is(
  (select count(*) from public.data_change_notifications)
    - (select n from _before),
  1::bigint,
  'a 5-row insert statement emits exactly one notification');

select is(
  (select (topic, server_id, payload->>'count')::text
   from public.data_change_notifications
   order by notification_id desc limit 1),
  '(arena_matches,580,5)',
  'notification carries topic, scoped server_id, and row count');

-- Mixed-server statements cannot claim a single server scope.
insert into public.arena_matches
  (observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id,
   server_id, week_start, game_uid)
select
  '00000000-0000-4000-8000-00000000dd11', 'user.get.arena.info', 'test',
  'test:notify:mixed:' || s, '2026-07-27T12:00:00Z',
  '00000000-0000-4000-8000-000000000c01', 580,
  s, public.reset_week_start('2026-07-27T12:00:00Z'::timestamptz),
  58100000 + s
from unnest(array[577, 578]) as s;

select is(
  (select server_id from public.data_change_notifications
   order by notification_id desc limit 1),
  null,
  'mixed-server statement leaves server_id null');

select * from finish();
rollback;
