-- RLS negative tests (§20.2 hard gate): every policy grant has a matching
-- proof that the unauthorized read fails. Personas: anon, viewer, member,
-- officer. Target rows are inserted first so the negatives cannot pass
-- vacuously against empty tables.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

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

insert into public.activity_facts
  (player_id, occurred_at, activity_type, metric_key, value_numeric, unit,
   source_type, measurement_type, idempotency_key)
select player_id, '2026-07-27T12:05:00Z', 'competition',
       'arena_participation', 1, 'boolean', 'arena_entries', 'observed',
       'test:fact:' || game_uid
from public.players where game_uid = 58000001;

insert into public.audit_logs (action, entity_type, entity_id)
values ('test.seed', 'test', 'rls');

insert into public.player_contributions
  (player_id, daily_donation_score, duel_weekly_score)
select player_id, 18400, 96200 from public.players where game_uid = 58000001;

-- Upsert, not insert: the seed's roster snapshots already project a presence
-- row through 0024's trigger. This file's contract is that the target row
-- exists so the negatives cannot pass vacuously, and an upsert says that
-- without depending on whether the seed happens to cover this player.
insert into public.player_presence (player_id, online_state, offline_since, observed_at)
select player_id, 'offline', '2026-07-27T09:12:45Z', '2026-07-28T00:17:20Z'
from public.players where game_uid = 58000001
on conflict (player_id) do update
  set online_state = excluded.online_state,
      offline_since = excluded.offline_since,
      observed_at = excluded.observed_at;

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
-- 0025: the arena board is public, and so is the lineup it shows. This ran as
-- the owner in the lineup's own test file and via service_role in sync, so
-- nothing checked the grant a logged-out reader actually needs — the answer
-- was 401 until one was added.
select lives_ok($$ select * from public.arena_entry_heroes $$,
  'anon may read arena lineups');
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

select isnt_empty($$ select * from public.arena_entries $$,
  'viewer reads arena entries');
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
