-- What `anon` and a bare `viewer` can reach through tables and views.
--
-- Companion to 57, which covers functions. The two doors are not the same
-- shape and the difference is the point of this file:
--
--   A function has no RLS. A grant to `anon` IS the boundary, which is why
--   57 exists and why two functions were found open.
--
--   A table has RLS underneath. `anon` holds undeclared INSERT/UPDATE/DELETE
--   on 66 relations in production — the platform's default privileges again —
--   and every one of them is inert, because RLS is on everywhere and no policy
--   admits `anon`. Assertions 1 and 2 are what make that true rather than
--   assumed.
--
--   A VIEW has neither. It carries no policies of its own, and unless it is
--   security_invoker it reads its sources as the OWNER — past every policy
--   underneath. That is the hole this file was written for: `alliance_growth`
--   was DEFINER by omission and served member-only data to any account.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- 1. RLS is the boundary under every table, so it has to be on under every
-- table. The hosted project has an `ensure_rls` event trigger that enables it
-- on CREATE TABLE; the local stack does not, so this is the check that runs
-- before a migration ever reaches production.
select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every table in public has row level security on');

-- 2. And no policy lets an anonymous request write. Without this, assertion 1
-- is only half an answer: RLS being on means nothing if a policy says yes.
--
-- `public` is in here as well as `anon`, because a policy naming no role
-- applies to PUBLIC, and anon is in PUBLIC — the same default that made
-- resolve_own_alliance() reachable in 0096.
select is_empty(
  $$ select tablename || ' (' || cmd || ')'
       from pg_policies
      where schemaname = 'public'
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        and roles::text[] && array['anon', 'public'] $$,
  'no policy lets an anonymous request write');

-- 3. The counterweight to 2. If the roles filter above were wrong, assertion 2
-- would pass by finding nothing at all, and this is what says it can find
-- something: the write policies that DO exist, for signed-in callers.
select cmp_ok(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and roles::text[] && array['authenticated']),
  '>', 0,
  'the previous assertion can see policies — these are the ones for members');

-- 4. Views that read as their owner, granted to signed-in callers, that never
-- ask who is asking. Each of these goes past every policy under it.
--
-- NO EXCEPTIONS ANY MORE. `sync_status` was named here until 0121: it published
-- one heartbeat timestamp from officer-only tables and 0060 argued the case,
-- but the only account the gap actually admitted was a signed-in VIEWER — and
-- `SyncStatus` never renders for one, so the carve-out bought no feature. 0121
-- gave it the same WHERE-clause gate the other eight carry.
--
-- A rule with no exceptions is one nobody has to remember the shape of. If a
-- view lands here again, gate it rather than adding a name back.
select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and (c.reloptions is null
             or c.reloptions::text !~ 'security_invoker=(true|on)')
        and has_table_privilege('authenticated', c.oid, 'select')
        and pg_get_viewdef(c.oid) !~*
            'current_app_role|has_permission|auth\.uid|linked_player_id|is_service_request' $$,
  'no view reads past RLS for a signed-in caller without gating itself');

-- 5-8. The specific case, with a positive control, because assertion 4 would
-- also pass on an empty schema.
--
-- A `viewer` is somebody who created an account and never redeemed a code.
-- 0065 made that the default and the whole member gate rests on it.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000fd001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'reach-viewer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000fd001', 'viewer');
-- WITH A HEARTBEAT. Without one, `max(last_heartbeat_at)` is null for
-- everybody and the sync_status assertion below passes whether the gate is
-- there or not — which is exactly how it first shipped.
insert into public.collectors (collector_id, name, last_heartbeat_at) values
  ('00000000-0000-4000-8000-00000000cf01', 'reach probe', now());
insert into public.alliances (server_id, external_id, current_name) values
  (580, 'reach-al', 'Reach');
insert into public.alliance_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, external_id,
   name, power, member_count, raw)
select gen_random_uuid(), 'alliance.rank', 1, 'reach-key-' || g,
       now() - (g || ' days')::interval,
       '00000000-0000-4000-8000-00000000cf01', 580, a.alliance_id, 580,
       'reach-al', 'Reach', 1000000 * g, 90, '{}'::jsonb
  from public.alliances a, generate_series(1, 2) g
 where a.external_id = 'reach-al';

-- The control. If this is 0 the four assertions below are about nothing.
select is(
  (select count(*)::int from public.alliance_snapshots where external_id = 'reach-al'),
  2, 'the probe rows exist, so the assertions below are about something');

set local role authenticated;
select set_config('request.jwt.claims',
                  json_build_object('sub', '00000000-0000-4000-8000-0000000fd001')::text,
                  true);

select is(public.current_app_role()::text, 'viewer', 'the session really is a viewer');

select is(
  (select count(*)::int from public.alliance_snapshots),
  0, 'RLS hides the snapshots from a viewer');

-- Was 1 before 0097. The view saw what the policy above had just refused.
select is(
  (select count(*)::int from public.alliance_growth),
  0, 'and the view over them does not hand it back');

-- 0121, the last carve-out closed. `sync_status` reads officer-only
-- `collectors` as its owner, and until 0121 it handed the heartbeat to any
-- signed-in account. A viewer is exactly the account that gap admitted.
--
-- The row still comes back — `max()` over nothing is null, so the shape the
-- component expects is unchanged — but it carries no timestamp.
select is(
  (select last_heartbeat_at from public.sync_status),
  null::timestamptz,
  'a viewer gets no heartbeat out of sync_status');

-- The positive beside it (0055), and here it is doing real work: a gate that
-- refused everybody would satisfy the negative above perfectly, and the board
-- would silently stop saying whether it is live.
reset role;
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000fd002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'reach-member@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000fd002', 'member');
set local role authenticated;
select set_config('request.jwt.claims',
                  json_build_object('sub', '00000000-0000-4000-8000-0000000fd002')::text,
                  true);

select isnt(
  (select last_heartbeat_at from public.sync_status),
  null::timestamptz,
  'while a member still gets the one fact the view exists to publish');

reset role;
select * from finish();
rollback;
