-- What an anonymous request may CALL, as opposed to what it may read.
--
-- RLS is the boundary for tables and this repo tests it hard. Functions are
-- the other door and nothing was watching it. Two separate mechanisms open a
-- function to `anon`, and each one hides from the fix for the other:
--
--   1. Postgres grants EXECUTE to PUBLIC on every new function, and `anon` is
--      in PUBLIC. A migration that says nothing about grants ships an
--      anonymous endpoint. This is how `resolve_own_alliance()` (0032) was an
--      unauthenticated writer for sixty-four migrations, until 0096.
--
--   2. The HOSTED project adds `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN
--      SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated`, which is a
--      DIRECT grant to those roles. `revoke ... from public` does not touch
--      it. This is how `record_departure()` (0094) was one, until 0095.
--
-- THE SECOND KIND CANNOT BE TESTED HERE. The local stack has no such default
-- privilege, so `anon` starts with nothing that PUBLIC did not give it, and an
-- assertion written locally passes whether or not the migration exists. The
-- check for that kind is `supabase db diff --linked` after a push, and it is a
-- step in docs/runbooks/going-public.md.
--
-- The first kind is real here, and the sweep below is the point of this file:
-- it fails for any FUTURE function, not just the two already found.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

-- 1. The class. This is the assertion worth keeping; the named cases under it
-- are only there to say what it caught.
--
-- A function `anon` can call, that writes, and that never asks who is asking.
-- `rebuild_rank_period` writes and is absent from this list because its first
-- statement is `build_rank_period`, which raises 42501 for a non-member.
select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and pg_get_function_result(p.oid) not in ('trigger', 'event_trigger')
        and has_function_privilege('anon', p.oid, 'execute')
        and p.prosrc ~* '\minsert into|\mupdate |\mdelete from'
        and p.prosrc !~* 'has_permission|current_app_role|auth\.uid|is_service_request' $$,
  'no function anon may call writes without checking who is asking');

-- 2-3. The two that were found, named so the failure says which one came back.
select ok(
  not has_function_privilege('anon', 'public.resolve_own_alliance()', 'execute'),
  'resolve_own_alliance is not an anonymous write endpoint (0096)');
select ok(
  not has_function_privilege('authenticated', 'public.resolve_own_alliance()', 'execute'),
  'nor a signed-in one — its callers are SECURITY DEFINER triggers');

-- 4. Deliberately still open, and the reason is the shape of the answer, not
-- the grant: it reports the caller's own role and 0045 grants it on purpose,
-- because a signed-out page has to be able to ask.
--
-- NOT `redeem_join_code`, which was the first thing written here and was
-- wrong. It is revoked from `public` and granted only to `authenticated`, so
-- it is anon-callable in production and not locally — the very split this
-- file's header is about. Asserting on it here would have been a local test
-- claiming to describe production again.
select ok(
  has_function_privilege('anon', 'public.current_app_role()', 'execute'),
  'a signed-out page may still ask what role it has');

-- 5. Pure functions stay open too. They compute a date from a date.
select ok(
  has_function_privilege('anon', 'public.reset_week_start(timestamptz)', 'execute'),
  'week arithmetic needs no permission');

-- 6. The trigger path still works after the revoke, which is the thing a
-- revoke is most likely to break. Both callers are SECURITY DEFINER and
-- execute as the owner, so they should not care — and this is where that
-- stops being an argument and starts being a fact.
insert into public.alliances (server_id, external_id, current_name, roster_unredacted_seen)
values (580, 'anon-test-a', 'A', false), (580, 'anon-test-b', 'B', false);

-- Insert, not update: there is no `own_alliance` row until somebody pins one,
-- so the first version of this updated nothing and then asserted on the
-- nothing it had done.
insert into public.app_settings (key, value)
values (
  'own_alliance',
  jsonb_build_object(
    'alliance_id',
    (select alliance_id from public.alliances where external_id = 'anon-test-b')))
on conflict (key) do update set value = excluded.value;

select is(
  (select external_id from public.alliances where is_own),
  'anon-test-b',
  'pinning an alliance still resolves is_own through the settings trigger');

select * from finish();
rollback;
