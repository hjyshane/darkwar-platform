-- Every snapshot table must carry the convention columns pinned in
-- CLAUDE.md, and idempotency_key must be unique — the sync worker's
-- logical exactly-once depends on the constraint, not on politeness.
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

select has_column('public', t.tbl, c.col, t.tbl || ' has ' || c.col)
from unnest(array[
  'player_snapshots',
  'player_detail_snapshots',
  'alliance_snapshots',
  'alliance_member_snapshots',
  'arena_matches',
  'arena_snapshots',
  'arena_entries'
]) as t(tbl)
cross join unnest(array[
  'observation_id',
  'source_command',
  'parser_version',
  'idempotency_key',
  'captured_at',
  'raw'
]) as c(col);

select col_is_unique('public', t.tbl, 'idempotency_key',
  t.tbl || '.idempotency_key is unique')
from unnest(array[
  'player_snapshots',
  'player_detail_snapshots',
  'alliance_snapshots',
  'alliance_member_snapshots',
  'arena_matches',
  'arena_snapshots',
  'arena_entries'
]) as t(tbl);

select has_function('public', 'reset_week_start', array['timestamptz'],
  'reset_week_start(timestamptz) exists');

-- Duplicate idempotency_key must be rejected by the database itself.
select lives_ok($$
  insert into public.arena_matches
    (observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id,
     server_id, week_start, game_uid)
  values
    ('00000000-0000-4000-8000-00000000dd01', 'user.get.arena.info', 'test',
     'test:duplicate-key', '2026-07-27T12:00:00Z',
     '00000000-0000-4000-8000-000000000c01', 580,
     580, public.reset_week_start('2026-07-27T12:00:00Z'::timestamptz),
     58000001)
$$, 'first insert with a fresh idempotency_key succeeds');

select throws_ok($$
  insert into public.arena_matches
    (observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id,
     server_id, week_start, game_uid)
  values
    ('00000000-0000-4000-8000-00000000dd02', 'user.get.arena.info', 'test',
     'test:duplicate-key', '2026-07-27T12:10:00Z',
     '00000000-0000-4000-8000-000000000c01', 580,
     580, public.reset_week_start('2026-07-27T12:10:00Z'::timestamptz),
     58000001)
$$, '23505', null, 'replaying the same idempotency_key is rejected');

select * from finish();
rollback;
