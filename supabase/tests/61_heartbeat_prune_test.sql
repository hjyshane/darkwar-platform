-- prune_collector_heartbeats: counts by default, deletes only when told, and
-- only what has aged out.
--
-- The contract under test is 0070's, restated by 0101: a pruner that deletes on
-- a bare call is a footgun, and a pruner that silently keeps everything is a
-- no-op wearing a safety label. Both failure modes pass a "does it run" check,
-- so the assertions here are about WHAT moved.
--
-- The local stack cannot prove the anon/authenticated revoke sticks in
-- production — the hosted platform's ALTER DEFAULT PRIVILEGES attaches direct
-- grants that do not exist locally (the 0095 class; see 57_anon_callable_test's
-- preamble). `db diff --linked` after push is what covers that. What CAN be
-- pinned locally is that the function does not slip into the anon-callable
-- writer set 57 polices, which the revoke here establishes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-00000000bea7', 'prune probe')
on conflict do nothing;

-- Ten old beats, five fresh ones.
insert into public.collector_heartbeats (collector_id, status, reported_at)
select '00000000-0000-4000-8000-00000000bea7', 'healthy',
       now() - interval '40 days' - (g || ' hours')::interval
from generate_series(1, 10) g;

insert into public.collector_heartbeats (collector_id, status, reported_at)
select '00000000-0000-4000-8000-00000000bea7', 'healthy',
       now() - (g || ' hours')::interval
from generate_series(1, 5) g;

-- 1. A bare call counts and touches nothing.
select results_eq(
  $$ select prunable, deleted from public.prune_collector_heartbeats() $$,
  $$ values (10::bigint, 0::bigint) $$,
  'count mode reports ten prunable beats and deletes none');

select is(
  (select count(*) from public.collector_heartbeats
    where collector_id = '00000000-0000-4000-8000-00000000bea7'),
  15::bigint,
  'and all fifteen rows are still there afterwards');

-- 2. Confirmed, it deletes exactly the aged rows.
select results_eq(
  $$ select prunable, deleted
       from public.prune_collector_heartbeats(p_confirm := true) $$,
  $$ values (10::bigint, 10::bigint) $$,
  'confirm mode deletes exactly what it counted');

select is(
  (select count(*) from public.collector_heartbeats
    where collector_id = '00000000-0000-4000-8000-00000000bea7'),
  5::bigint,
  'the five fresh beats survive');

-- 3. The window is the caller's to widen or narrow.
select results_eq(
  $$ select prunable from public.prune_collector_heartbeats(
       p_keep := interval '100 days') $$,
  $$ values (0::bigint) $$,
  'a wider window holds everything back');

-- 4. Not callable by the app roles. Locally this checks the revoke as written;
-- the hosted platform's direct grants are 57's documented blind spot and
-- db diff --linked territory.
select ok(
  not has_function_privilege('anon',
    'public.prune_collector_heartbeats(boolean, interval)', 'execute')
  and not has_function_privilege('authenticated',
    'public.prune_collector_heartbeats(boolean, interval)', 'execute'),
  'neither anon nor authenticated may run the pruner');

select * from finish();
rollback;
