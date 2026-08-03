-- 0062: the arena has two boards and nothing distinguished them.
--
-- The bug was never in storage — both leagues were already separate rows,
-- because idempotency_key hashes the raw payload. It was that no column
-- said which was which, so the only query the dashboard could write took
-- the newest row and showed one league.
--
-- Three things to hold: the discriminator survives a replay, a snapshot
-- that never reported one stays null rather than defaulting to a league,
-- and the column is world-readable like the rest of the arena.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000ca01', 'league test', 'offline', 'test')
on conflict do nothing;

create function pg_temp.board(key text, league smallint, captured timestamptz)
returns uuid language sql as $$
  insert into public.arena_snapshots
    (observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, server_id,
     week_start, entry_count, league, raw)
  values
    (gen_random_uuid(), 'user.get.arena.info', 'test', key, captured,
     '00000000-0000-4000-8000-00000000ca01', 580, 580,
     public.reset_week_start(captured), 100, league,
     jsonb_build_object('arenaType', 1, 'selfArenaType', 1))
  returning snapshot_id;
$$;

select has_column('public', 'arena_snapshots', 'league',
  'arena_snapshots knows which board it is');

-- Silver is captured seconds AFTER Gold by the collector's routine, which is
-- exactly how Gold went unseen: newest-first returned Silver every time.
select pg_temp.board('test:league:gold', 1::smallint, '2026-07-27T23:40:00Z') as gold \gset
select pg_temp.board('test:league:silver', 2::smallint, '2026-07-27T23:40:02Z') as silver \gset

select is(
  (select league from public.arena_snapshots where snapshot_id = :'gold'::uuid),
  1::smallint, 'Gold stores as 1');
select is(
  (select league from public.arena_snapshots where snapshot_id = :'silver'::uuid),
  2::smallint, 'Silver stores as 2');

-- The query the panel actually runs: newest board PER league, not newest
-- board. Two rows, or the older league is invisible again.
select is(
  (select count(*) from (
     select distinct on (league) snapshot_id
     from public.arena_snapshots
     where collector_id = '00000000-0000-4000-8000-00000000ca01'
     order by league, captured_at desc) as newest),
  2::bigint,
  'the newest-per-league query returns both boards, not just the later one');

-- FR-UI-008. proto3 omits defaults, so a payload with no userArenaType is
-- not league 0 and must not be filed under league 1 either.
select pg_temp.board('test:league:unknown', null, '2026-07-27T23:41:00Z') as unknown \gset
select is(
  (select league from public.arena_snapshots where snapshot_id = :'unknown'::uuid),
  null::smallint, 'a snapshot that never said stays null');

-- No check constraint on purpose: two observations are not enough to rule
-- out a third board, and a constraint written from them would reject the
-- capture that proves it.
select lives_ok(
  $$ select pg_temp.board('test:league:third', 3::smallint, '2026-07-27T23:42:00Z') $$,
  'a league nobody has seen yet is stored, not rejected');

-- Adding a column to a table whose grant is table-level needs no new grant,
-- but 0051 taught that assuming so is how a column becomes unreadable.
set local role anon;
select throws_ok(
  $$ select league from public.arena_snapshots $$,
  '42501', null, 'anon cannot read the league, like the rest of the arena board');
reset role;

select * from finish();
rollback;
