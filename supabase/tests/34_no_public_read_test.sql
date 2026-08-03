-- 0065: nothing in this app is public, including the things not written yet.
--
-- This file is the only part of that promise that keeps working. The
-- migration fixed the eighteen tables that existed on the day it ran; a
-- table added next month inherits nothing from it. What it inherits is this
-- test failing.
--
-- So the assertions are deliberately written as "no relation anywhere in
-- public may be read by anon" rather than as a list of table names. A list
-- would need editing every time a table is added, and the edit that adds
-- the table is exactly the edit that would quietly add it to the list.
--
-- If you are reading this because CI failed on a new table: that is the
-- test doing its job, not an obstacle. Give the table a member policy and
-- do not grant SELECT to anon. If the table genuinely must be public, say
-- so out loud — add it to the ALLOWED list below with the reason, so that
-- "this one is public" is a sentence somebody wrote rather than an omission.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

-- Nothing is allowed to be public today. The list exists so that a future
-- exception has an obvious home and has to be argued for in a diff.
create temp table allowed_public (relname text primary key, why text);

select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and has_table_privilege('anon', c.oid, 'SELECT')
        and c.relname not in (select relname from allowed_public) $$,
  'no table, view or matview in public is readable by anon');

-- The grant is one lever and the policy is the other. A policy naming anon
-- does nothing while the grant is revoked, but it states an intention that
-- the next `grant select` would suddenly honour.
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and 'anon' = any(roles) $$,
  'no policy in public names anon');

-- Views do not have row level security. A security_invoker view runs with
-- the reader's rights, so the underlying policies still apply; one that
-- does NOT runs as its owner and the grant is the only thing between it and
-- the world. sync_status is such a view, which is why this is asserted
-- rather than assumed.
select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and coalesce((select option_value from pg_options_to_table(c.reloptions)
                       where option_name = 'security_invoker'), 'false') = 'false'
        and has_table_privilege('anon', c.oid, 'SELECT') $$,
  'no owner-rights view is exposed to anon — for those the grant is the only gate');

-- Two spot checks with the real role attached, because privilege catalogues
-- and actual behaviour have disagreed before.
set local role anon;
select throws_ok($$ select * from public.players $$, '42501',
  null, 'anon reading players is refused outright, not merely filtered');
select throws_ok($$ select * from public.arena_entry_heroes $$, '42501',
  null, 'and the arena the same way');
reset role;

-- And the other half of the promise: a member still reads. A schema that
-- refuses everyone is not private, it is broken, and this repo has shipped
-- a dropped grant that looked exactly like a working restriction (0051).
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-00000000f101', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'nopublic-member@test.invalid');
insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-00000000f101', 'member', 'nopublic member');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f101","role":"authenticated"}', true);
select isnt_empty($$ select * from public.players $$,
  'a member still reads the roster');
reset role;

select * from finish();
rollback;
