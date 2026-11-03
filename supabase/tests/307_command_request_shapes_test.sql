-- 0307: request shapes are admin-only to read, and a repeat sighting widens the window.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

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
  ('00000000-0000-4000-8000-0000000307a1'::uuid, 'viewer307@test.local'),
  ('00000000-0000-4000-8000-0000000307a2'::uuid, 'officer307@test.local'),
  ('00000000-0000-4000-8000-0000000307a3'::uuid, 'admin307@test.local')
) as u(id, email);

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000307a1', 'viewer'),
  ('00000000-0000-4000-8000-0000000307a2', 'officer'),
  ('00000000-0000-4000-8000-0000000307a3', 'admin');

insert into public.command_request_shapes
  (source_command, fingerprint, sample, first_seen_at, last_seen_at)
values ('world.get.new', 'fp307', '{"viewLvl": "integer"}'::jsonb,
        '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z');

-- A second sighting, as sync delivers it: merge on the natural key.
insert into public.command_request_shapes
  (source_command, fingerprint, sample, first_seen_at, last_seen_at)
values ('world.get.new', 'fp307', '{"viewLvl": "integer"}'::jsonb,
        '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z')
on conflict (source_command, fingerprint) do update
set first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at;

select is((select first_seen_at from public.command_request_shapes where fingerprint = 'fp307'),
  '2026-11-01T10:00:00Z'::timestamptz, 'first_seen_at never moves forward');
select is((select last_seen_at from public.command_request_shapes where fingerprint = 'fp307'),
  '2026-11-02T10:00:00Z'::timestamptz, 'last_seen_at advances');
select is((select count(*)::int from public.command_request_shapes), 1,
  'a repeat is one row, not two');

set local role anon;
select throws_ok($$ select * from public.command_request_shapes $$, '42501',
  null, 'anon is refused');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000307a1","role":"authenticated"}', true);
select is_empty($$ select * from public.command_request_shapes $$, 'viewer reads nothing');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000307a2","role":"authenticated"}', true);
select is_empty($$ select * from public.command_request_shapes $$, 'officer reads nothing');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000307a3","role":"authenticated"}', true);
select isnt_empty($$ select * from public.command_request_shapes $$, 'admin reads the shapes');

reset role;
select * from finish();
rollback;
