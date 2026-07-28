-- RLS negative tests (§20.2 hard gate): every policy grant has a matching
-- proof that the unauthorized read fails. Personas: anon, viewer, member,
-- officer. Target rows are inserted first so the negatives cannot pass
-- vacuously against empty tables.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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

select is((select count(*) from public.players), 20::bigint,
  'anon reads public rankings');
select is_empty($$ select * from public.alliance_member_snapshots $$,
  'anon cannot read alliance-internal presence');
select throws_ok('select count(*) from internal.raw_observations', '42501',
  null, 'anon cannot touch raw payloads in the internal schema');

reset role;

-- viewer (authenticated, no elevated role)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f001","role":"authenticated"}',
  true);

select is((select count(*) from public.arena_entries), 20::bigint,
  'viewer reads arena entries');
select is_empty($$ select * from public.alliance_member_snapshots $$,
  'viewer cannot read alliance-internal presence');
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

select is((select count(*) from public.alliance_member_snapshots),
  20::bigint, 'member reads alliance-internal presence');

-- officer
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f003","role":"authenticated"}',
  true);

select is((select count(*) from public.activity_facts), 1::bigint,
  'officer reads activity facts');
select lives_ok($$
  insert into public.refresh_jobs (job_type, requested_by)
  values ('manual.refresh', '00000000-0000-4000-8000-00000000f003')
$$, 'officer creates a refresh job for themselves');

reset role;

select * from finish();
rollback;
