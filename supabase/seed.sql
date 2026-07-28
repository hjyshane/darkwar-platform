-- Synthetic dev/test data (S2): one alliance, a 20-player roster snapshot,
-- and one arena week. Servers 577–584 are NOT here — they are operational
-- fact and live in migration 0002.
--
-- Everything is deterministic (fixed UUIDs, fixed timestamps) so tests and
-- the dashboard can assert against known values. game_uids are synthetic
-- (58000001–58000020) and idempotency keys use a seed: prefix so a real
-- collector can never collide with them.

-- Seed collector: snapshot provenance FKs require a registered collector.
insert into public.collectors (collector_id, name, status, version)
values (
  '00000000-0000-4000-8000-000000000c01',
  'seed-collector',
  'offline',
  'seed'
);

-- Raw observations backing the two snapshot batches, so FR-ACT-008
-- drill-down (fact → snapshot → observation → payload) is exercisable
-- against seed data.
insert into internal.raw_observations
  (observation_id, collector_id, source_command, captured_at, payload)
values
  ('00000000-0000-4000-8000-000000000b01',
   '00000000-0000-4000-8000-000000000c01',
   'al.rank', '2026-07-27T12:00:00Z',
   '{"synthetic": true, "note": "seed roster payload"}'),
  ('00000000-0000-4000-8000-000000000b02',
   '00000000-0000-4000-8000-000000000c01',
   'user.get.arena.info', '2026-07-27T12:05:00Z',
   '{"synthetic": true, "note": "seed arena payload"}');

insert into public.alliances
  (alliance_id, server_id, external_id, current_name, current_code,
   power, member_count, first_seen_at, last_seen_at)
values
  ('00000000-0000-4000-8000-00000000a001', 580, 987001,
   'Synthetic CBFW', 'CBFW', 210000000, 20,
   '2026-07-27T12:00:00Z', '2026-07-27T12:00:00Z');

insert into public.alliance_names
  (alliance_id, name, code, first_seen_at, last_seen_at)
values
  ('00000000-0000-4000-8000-00000000a001', 'Synthetic CBFW', 'CBFW',
   '2026-07-27T12:00:00Z', '2026-07-27T12:00:00Z');

-- 20 players, power descending with rank so ordering is assertable.
insert into public.players
  (player_id, game_uid, server_id, current_name, current_alliance_id,
   hq_level, power, kills, first_seen_at, last_seen_at)
select
  ('00000000-0000-4000-8000-' || lpad(to_hex(58000000 + i), 12, '0'))::uuid,
  58000000 + i,
  580,
  'SyntheticPlayer' || lpad(i::text, 2, '0'),
  '00000000-0000-4000-8000-00000000a001',
  20 + (i % 10),
  (21 - i)::bigint * 10000000,
  (21 - i)::bigint * 50000,
  '2026-07-27T12:00:00Z',
  '2026-07-27T12:00:00Z'
from generate_series(1, 20) as i;

insert into public.player_names (player_id, name, first_seen_at, last_seen_at)
select
  player_id, current_name, '2026-07-27T12:00:00Z', '2026-07-27T12:00:00Z'
from public.players
where server_id = 580 and game_uid between 58000001 and 58000020;

-- Roster snapshot from the al.rank observation.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, raw,
   alliance_id, server_id, player_id, game_uid, name, member_rank,
   hq_level, power, kills, presence_redacted, online_state)
select
  '00000000-0000-4000-8000-000000000b01',
  'al.rank',
  'seed',
  'seed:al.rank:580:2026-07-27:' || p.game_uid,
  '2026-07-27T12:00:00Z',
  '00000000-0000-4000-8000-000000000c01',
  580,
  jsonb_build_object('synthetic', true),
  '00000000-0000-4000-8000-00000000a001',
  580,
  p.player_id,
  p.game_uid,
  p.current_name,
  case when p.game_uid = 58000001 then 5 else 1 + (p.game_uid % 4)::int end,
  p.hq_level,
  p.power,
  p.kills,
  false,
  case when p.game_uid % 3 = 0 then 'online' else 'offline' end
from public.players p
where p.server_id = 580 and p.game_uid between 58000001 and 58000020;

-- One arena week: ranking header + 20 entries from the arena observation.
insert into public.arena_snapshots
  (snapshot_id, observation_id, source_command, parser_version,
   idempotency_key, captured_at, collector_id, collected_from_server_id,
   raw, server_id, week_start, entry_count)
values
  ('00000000-0000-4000-8000-00000000ee01',
   '00000000-0000-4000-8000-000000000b02',
   'user.get.arena.info',
   'seed',
   'seed:user.get.arena.info:580:2026-07-27:header',
   '2026-07-27T12:05:00Z',
   '00000000-0000-4000-8000-000000000c01',
   580,
   jsonb_build_object('synthetic', true),
   580,
   public.reset_week_start('2026-07-27T12:05:00Z'::timestamptz),
   20);

insert into public.arena_entries
  (observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, raw,
   arena_snapshot_id, server_id, player_id, game_uid, name, rank,
   score, defense_power)
select
  '00000000-0000-4000-8000-000000000b02',
  'user.get.arena.info',
  'seed',
  'seed:user.get.arena.info:580:2026-07-27:' || p.game_uid,
  '2026-07-27T12:05:00Z',
  '00000000-0000-4000-8000-000000000c01',
  580,
  jsonb_build_object('synthetic', true),
  '00000000-0000-4000-8000-00000000ee01',
  580,
  p.player_id,
  p.game_uid,
  p.current_name,
  (p.game_uid - 58000000)::int,
  1200 - (p.game_uid - 58000000)::int * 25,
  p.power / 2
from public.players p
where p.server_id = 580 and p.game_uid between 58000001 and 58000020;
