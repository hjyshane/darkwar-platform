-- 0021: redeeming a code grants a role, and every way it could grant too
-- much is closed. The negatives are the point of this file.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

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
  ('00000000-0000-4000-8000-00000000e001'::uuid, 'joiner@test.local'),
  ('00000000-0000-4000-8000-00000000e002'::uuid, 'officer2@test.local'),
  ('00000000-0000-4000-8000-00000000e003'::uuid, 'guesser@test.local')
) as u(id, email);

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-00000000e002', 'officer');

insert into public.join_codes (code, grants_role, max_uses, expires_at) values
  ('GOODCODE01', 'member', 2, now() + interval '7 days'),
  ('EXPIRED001', 'member', null, now() - interval '1 day'),
  ('REVOKED001', 'member', null, null),
  ('USEDUP0001', 'member', 1, null);

update public.join_codes set revoked_at = now() where code = 'REVOKED001';
update public.join_codes set used_count = 1 where code = 'USEDUP0001';

-- The table itself is not client-readable at any role; only the function is.
select is_empty(
  $$ select tablename from pg_tables
     where schemaname = 'public' and tablename = 'join_codes' and not rowsecurity $$,
  'join_codes has RLS enabled');

-- A code cannot be written to grant admin, whatever the caller intends.
select throws_ok($$
  insert into public.join_codes (code, grants_role) values ('ADMINGRAB1', 'admin')
$$, '23514', null, 'a code cannot grant admin');
select throws_ok($$
  insert into public.join_codes (code, grants_role) values ('SVCGRAB001', 'collector_service')
$$, '23514', null, 'a code cannot grant a service role');

set local role authenticated;

-- guesser: wrong codes fail identically and eventually lock out.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000e003","role":"authenticated"}', true);

-- Null, not an exception: raising would roll back the attempt counter in
-- the same breath, and a throttle that erases its own count is not one.
select is(public.redeem_join_code('NOTACODE01'), null::public.app_role,
  'an unknown code is refused');
select is(public.redeem_join_code('EXPIRED001'), null::public.app_role,
  'an expired code gives the same answer');
select is(public.redeem_join_code('REVOKED001'), null::public.app_role,
  'a revoked code gives the same answer');
select is(public.redeem_join_code('USEDUP0001'), null::public.app_role,
  'an exhausted code gives the same answer');

-- Four failures so far. The fifth is still let through and still refused as
-- a bad code; it is the sixth that meets the cap.
select is(public.redeem_join_code('NOPENOPE01'), null::public.app_role,
  'the fifth attempt is still a code refusal, not a lockout');
select throws_ok($$ select public.redeem_join_code('GOODCODE01') $$, '54000',
  'too many attempts; try again later',
  'once locked out, even a valid code is refused');

-- joiner: a clean account redeems successfully.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);

select is(public.redeem_join_code('GOODCODE01'), 'member'::public.app_role,
  'a valid code grants the role it carries');
select is((select role from public.app_users
           where user_id = '00000000-0000-4000-8000-00000000e001'),
          'member'::public.app_role,
  'the app_users row now exists with that role');

-- officer redeeming a member code must not be demoted.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000e002","role":"authenticated"}', true);

select is(public.redeem_join_code('GOODCODE01'), 'officer'::public.app_role,
  'redeeming a member code never downgrades an officer');

select * from finish();
rollback;
