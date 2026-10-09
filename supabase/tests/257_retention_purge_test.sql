-- 0256: batched retention. What matters is what SURVIVES: ours, the newest
-- sighting of every base, and anything inside the window.
--
-- Runs as service_role on purpose: pgTAP otherwise runs as the migration owner
-- and a missing grant (own_player_ids) would pass here and 42501 in production.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cf54', 'purge test', 'offline', 'test')
on conflict do nothing;

insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-0000000054aa'::uuid, 580, 'aaaa0000000000000000000000000054', 'OURS', true, 1),
  ('00000000-0000-4000-8000-0000000054bb'::uuid, 581, 'bbbb0000000000000000000000000054', 'THEIRS', false, 1);

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000054c1'::uuid, 580, 954000580, 'Ours'),
  ('00000000-0000-4000-8000-0000000054c2'::uuid, 581, 954000581, 'Stranger');

-- presence_redacted decides is_own (see 39_retention_test): false marks ours.
-- Four rows: ours old, theirs old, theirs fresh, ours inside 3 months.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id, name,
   presence_redacted)
values
  (gen_random_uuid(), 'al.rank', 'test', 'test:purge:m1', now() - interval '40 days',
   '00000000-0000-4000-8000-00000000cf54', 580, '00000000-0000-4000-8000-0000000054aa',
   580, 954000580, '00000000-0000-4000-8000-0000000054c1', 'Ours', false),
  (gen_random_uuid(), 'al.rank', 'test', 'test:purge:m2', now() - interval '40 days',
   '00000000-0000-4000-8000-00000000cf54', 580, '00000000-0000-4000-8000-0000000054bb',
   581, 954000581, '00000000-0000-4000-8000-0000000054c2', 'Stranger', true),
  (gen_random_uuid(), 'al.rank', 'test', 'test:purge:m3', now() - interval '2 days',
   '00000000-0000-4000-8000-00000000cf54', 580, '00000000-0000-4000-8000-0000000054bb',
   581, 954000581, '00000000-0000-4000-8000-0000000054c2', 'Stranger', true),
  (gen_random_uuid(), 'al.rank', 'test', 'test:purge:m4', now() - interval '10 days',
   '00000000-0000-4000-8000-00000000cf54', 580, '00000000-0000-4000-8000-0000000054bb',
   581, 954000581, '00000000-0000-4000-8000-0000000054c2', 'Stranger', true);

-- One base seen three times (old, old, fresh) and another seen once, long ago.
insert into public.world_city_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, game_uid, point_id, x, y)
values
  (gen_random_uuid(), 'world.get.new', 'test', 'test:purge:w1', now() - interval '30 days',
   '00000000-0000-4000-8000-00000000cf54', 580, 581, 954000581, 100100, 100, 100),
  (gen_random_uuid(), 'world.get.new', 'test', 'test:purge:w2', now() - interval '20 days',
   '00000000-0000-4000-8000-00000000cf54', 580, 581, 954000581, 100100, 100, 100),
  (gen_random_uuid(), 'world.get.new', 'test', 'test:purge:w3', now() - interval '1 day',
   '00000000-0000-4000-8000-00000000cf54', 580, 581, 954000581, 100100, 100, 100),
  (gen_random_uuid(), 'world.get.new', 'test', 'test:purge:w4', now() - interval '60 days',
   '00000000-0000-4000-8000-00000000cf54', 580, 581, 954000999, 200200, 200, 200);

set local role service_role;

select is(
  (select rows from public.retention_purge() where relation = 'alliance_member_snapshots'),
  2::bigint,
  'counts the two stranger rows outside the 7-day window and nothing else');

select is(
  (select rows from public.retention_purge() where relation = 'world_city_snapshots'),
  2::bigint,
  'counts the two superseded sightings, not the newest per base');

select is((select count(*) from public.world_city_snapshots where idempotency_key like 'test:purge:w%'),
  4::bigint, 'counting deleted nothing');

-- A batch of 1 removes at most one row per table.
select is(
  (select rows from public.retention_purge(true, p_batch := 1)
    where relation = 'alliance_member_snapshots'),
  1::bigint, 'p_batch caps a call at one row per table');

select * from public.retention_purge(true);
select * from public.retention_purge(true);

select is(
  (select count(*) from public.alliance_member_snapshots where idempotency_key like 'test:purge:m%'),
  2::bigint, 'ours (old) and the stranger row inside the window survive');

select is(
  (select count(*) from public.alliance_member_snapshots where idempotency_key = 'test:purge:m1'),
  1::bigint, 'our departed-style history is kept on the 3-month window');

select is(
  (select array_agg(idempotency_key order by idempotency_key)
     from public.world_city_snapshots where idempotency_key like 'test:purge:w%'),
  array['test:purge:w3', 'test:purge:w4'],
  'the newest sighting of each base survives, even one 60 days old');

select throws_ok($$ select * from public.retention_purge(true, p_batch := 0) $$,
  'P0001', null, 'a zero batch is refused rather than looping forever');

reset role;
select is(
  (select count(*) from public.players where player_id in
    ('00000000-0000-4000-8000-0000000054c1', '00000000-0000-4000-8000-0000000054c2')),
  2::bigint, 'players are never in scope');

select * from finish();
rollback;
