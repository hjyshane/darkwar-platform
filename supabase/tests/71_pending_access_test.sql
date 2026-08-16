-- 0123: who can see the people waiting at the door.
--
-- The view exists because the row does not: `app_users` gets its row from
-- `redeem_join_code`, so somebody who signed in without a code is absent from
-- that table rather than present as a 'viewer'. The first assertion below is
-- that fact, not the permissions — because if it stops being true, the view is
-- answering a question nobody is asking and the alert quietly reports nobody.
--
-- Then the gate. This view reaches into `auth.users`, so it is DEFINER and its
-- only protection is the WHERE clause. A widening here does not leak a power
-- number; it leaks the existence of accounts to whoever should not have it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000da001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'waiting@test.invalid'),
  ('00000000-0000-4000-8000-0000000da002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000da003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member@test.invalid');

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000da002', 'admin'),
  ('00000000-0000-4000-8000-0000000da003', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- ------------------------------------------------- the premise this rests on
select is(
  (select count(*) from public.app_users where role = 'viewer'),
  0::bigint,
  'nobody is stored as a viewer - the fallback role has no rows, which is why '
  'searching app_users for waiting accounts finds nobody and looks like it worked');

-- ------------------------------------------------------------- the collector
-- Unwrapped, like 45: pgTAP runs as the migration owner, which
-- `is_service_request()` accepts as the collector's side of the boundary.
select is(
  (select count(*) from public.pending_access
    where user_id = '00000000-0000-4000-8000-0000000da001'),
  1::bigint,
  'the notifier sees the account that redeemed no code - zero here would read '
  'as nobody waiting, which is what 0077 was written about');

select is(
  (select count(*) from public.pending_access
    where user_id = '00000000-0000-4000-8000-0000000da003'),
  0::bigint,
  'a member who redeemed a code is not waiting for anything');

-- ------------------------------------------------------------------ a person
--
-- `set local role authenticated` as well as the JWT claim, and the first version
-- of this file forgot it. `is_service_request()` reads `current_user`, which
-- without this stays the migration owner — so BOTH person assertions below ran
-- down the collector's branch of the predicate. The member one failed, which is
-- the only reason the omission was noticed; the admin one had passed for a
-- reason that had nothing to do with being an admin.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000da002');
select is(
  (select count(*) from public.pending_access
    where user_id = '00000000-0000-4000-8000-0000000da001'),
  1::bigint,
  'an admin sees them on the members screen, where the decision is made');

select pg_temp.act_as('00000000-0000-4000-8000-0000000da003');
select is(
  (select count(*) from public.pending_access),
  0::bigint,
  'an ordinary member sees nobody - who is signed up is not roster information');

reset role;

-- ------------------------------------------------------------------- the door
-- The negative test §20.2 demands. `anon` must not be able to enumerate
-- accounts, and a DEFINER view is exactly the shape that forgets to say so.
--
-- After `reset role`, not before: `authenticated` cannot switch itself to
-- `anon`, so run from the owner and let the statement do its own switch.
select throws_ok(
  $$ set local role anon; select count(*) from public.pending_access $$,
  '42501',
  NULL,
  'anon cannot read pending_access at all - not an empty list, a refusal');

reset role;

select * from finish();
rollback;
