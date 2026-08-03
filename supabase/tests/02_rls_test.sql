-- RLS negative tests (§20.2 hard gate): every policy grant has a matching
-- proof that the unauthorized read fails. Personas: anon, viewer, member,
-- officer. Target rows are inserted first so the negatives cannot pass
-- vacuously against empty tables.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- Setup (as postgres, RLS not yet in play): three auth users + rows in the
-- restricted tables.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data,
   is_super_admin, confirmation_token, recovery_token)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated',
  'authenticated', u.email, '', now(), now(), now(), '{}', '{}',
  false, '', ''
from (values
  ('00000000-0000-4000-8000-00000000f001'::uuid, 'viewer@test.local'),
  ('00000000-0000-4000-8000-00000000f002'::uuid, 'member@test.local'),
  ('00000000-0000-4000-8000-00000000f003'::uuid, 'officer@test.local')
) as u(id, email);

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-00000000f001', 'viewer'),
  ('00000000-0000-4000-8000-00000000f002', 'member'),
  ('00000000-0000-4000-8000-00000000f003', 'officer');

-- This file's own player. It used to reach for the seed's 58000001, which
-- worked right up until the seed was deleted to make room for a real
-- capture: `insert ... select ... where game_uid = 58000001` then selects
-- nothing, inserts nothing, and RAISES NOTHING. Every negative below would
-- have gone on passing against rows that no longer existed — the vacuous
-- green this file's own header promises not to allow.
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000ac902', 580, 58009902, 'RlsTarget');

insert into public.activity_facts
  (player_id, occurred_at, activity_type, metric_key, value_numeric, unit,
   source_type, measurement_type, idempotency_key)
select player_id, '2026-07-27T12:05:00Z', 'competition',
       'arena_participation', 1, 'boolean', 'arena_entries', 'observed',
       'test:fact:' || game_uid
from public.players where game_uid = 58009902;

insert into public.audit_logs (action, entity_type, entity_id)
values ('test.seed', 'test', 'rls');

insert into public.player_contributions
  (player_id, daily_donation_score, duel_weekly_score)
select player_id, 18400, 96200 from public.players where game_uid = 58009902;

-- Upsert, not insert: 0024's trigger projects a presence row from any roster
-- snapshot, so this player may already have one. The contract is that the
-- row EXISTS, not that this statement created it.
insert into public.player_presence (player_id, online_state, offline_since, observed_at)
select player_id, 'offline', '2026-07-27T09:12:45Z', '2026-07-28T00:17:20Z'
from public.players where game_uid = 58009902
on conflict (player_id) do update
  set online_state = excluded.online_state,
      offline_since = excluded.offline_since,
      observed_at = excluded.observed_at;

-- This file's own arena rows. 0064 turned the arena member-only, and an
-- is_empty() proving that would pass just as well against a database with
-- no arena in it at all — which is exactly how the seed-borrowing negatives
-- in this file went quietly vacuous once the seed was deleted.
insert into public.arena_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, week_start, entry_count, league)
values
  ('00000000-0000-4000-8000-00000000ae01', 'user.get.arena.info', 'test',
   'test:rls:arena:header', '2026-07-27T23:40:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580,
   public.reset_week_start('2026-07-27T23:40:00Z'::timestamptz), 1, 1);

insert into public.arena_entries
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, arena_snapshot_id,
   server_id, game_uid, rank, score, defense_power)
select '00000000-0000-4000-8000-00000000ae02', '00000000-0000-4000-8000-00000000ae02',
       'user.get.arena.info', 'test', 'test:rls:arena:entry', '2026-07-27T23:40:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, snapshot_id, 580, 58009902, 1, 1500, 400000000
from public.arena_snapshots where idempotency_key = 'test:rls:arena:header';

insert into public.arena_entry_heroes
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, arena_entry_id, server_id, game_uid,
   hero_id, slot, level_synced)
values
  ('00000000-0000-4000-8000-00000000ae03', 'user.get.arena.info', 'test',
   'test:rls:arena:hero', '2026-07-27T23:40:00Z',
   '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-00000000ae02', 580, 58009902, 40001, 1, false);

insert into public.schema_observations (source_command, fingerprint)
values ('unknown.command', 'test-fingerprint');

insert into public.refresh_jobs (job_type, requested_by)
values ('manual.refresh', '00000000-0000-4000-8000-00000000f003');

-- Deny-all default: a table created without policies must at least have
-- RLS enabled, or PostgREST would serve it wide open.
select is_empty(
  $$ select tablename from pg_tables
     where schemaname = 'public' and not rowsecurity $$,
  'every table in public has RLS enabled');

-- anon
set local role anon;

-- Visibility, not totals: these must hold whatever else is in the
-- database, so they assert presence rather than a row count.
select isnt_empty($$ select * from public.players $$,
  'anon reads public rankings');
select is_empty($$ select snapshot_id, name from public.alliance_member_snapshots $$,
  'anon cannot read alliance-internal presence');
-- 0025 made the arena board public and 0064 took it back, before anything
-- went on the internet. As an endpoint 3,998 decoded defence lineups are a
-- scouting download rather than a screen. The grant is still there — a
-- logged-in member needs it — so this asserts the POLICY withholds the
-- rows, which is a different failure from a missing grant and reads
-- differently when it breaks.
select is_empty($$ select * from public.arena_entry_heroes $$,
  'anon cannot read arena lineups');
select is_empty($$ select * from public.arena_entries $$,
  'nor who is on the board');
-- 0020: these scores lived on players, which anon reads, until they moved.
select is_empty($$ select * from public.player_contributions $$,
  'anon cannot read alliance contribution');
-- 0024: presence follows contribution off players for the same reason. The
-- world-readable last_seen_at is when the collector looked; this is when the
-- player was actually there, and that is alliance-internal (§17.3).
select is_empty($$ select * from public.player_presence $$,
  'anon cannot read member presence');
-- The column is gone, not merely filtered — a projection of restricted data
-- onto a world-readable table is how it leaked in the first place.
select throws_ok($$ select daily_donation_score from public.players $$, '42703',
  null, 'contribution is not a column on the public players table');
select throws_ok('select count(*) from internal.raw_observations', '42501',
  null, 'anon cannot touch raw payloads in the internal schema');

reset role;

-- viewer (authenticated, no elevated role)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f001","role":"authenticated"}',
  true);

-- 0064: a signed-in VIEWER is not a member, and the arena is a member
-- screen now. Signing in is not the gate; holding the role is.
select is_empty($$ select * from public.arena_entries $$,
  'a signed-in viewer cannot read arena entries either');
select is_empty($$ select snapshot_id, name from public.alliance_member_snapshots $$,
  'viewer cannot read alliance-internal presence');
select is_empty($$ select * from public.player_contributions $$,
  'viewer cannot read alliance contribution');
select is_empty($$ select * from public.player_presence $$,
  'viewer cannot read member presence');
select is_empty($$ select * from public.activity_facts $$,
  'viewer cannot read activity facts');
select is_empty($$ select * from public.audit_logs $$,
  'viewer cannot read audit logs');
select is_empty($$ select * from public.schema_observations $$,
  'viewer cannot read the discovery inbox');
select is_empty($$ select * from public.refresh_jobs $$,
  'viewer cannot read refresh jobs');
select throws_ok($$
  insert into public.refresh_jobs (job_type, requested_by)
  values ('manual.refresh', '00000000-0000-4000-8000-00000000f001')
$$, '42501', null, 'viewer cannot create refresh jobs');

-- member
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f002","role":"authenticated"}',
  true);

select isnt_empty($$ select snapshot_id, name from public.alliance_member_snapshots $$,
  'member reads alliance-internal presence');
select isnt_empty($$ select * from public.player_contributions $$,
  'member reads alliance contribution');
select isnt_empty($$ select * from public.player_presence $$,
  'member reads member presence');

-- officer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f003","role":"authenticated"}',
  true);

select isnt_empty($$ select * from public.activity_facts $$,
  'officer reads activity facts');
select lives_ok($$
  insert into public.refresh_jobs (job_type, requested_by)
  values ('manual.refresh', '00000000-0000-4000-8000-00000000f003')
$$, 'officer creates a refresh job for themselves');

reset role;

select * from finish();
rollback;
