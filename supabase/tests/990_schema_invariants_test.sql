-- Rules that hold for the whole schema, not one migration (2026-11-24).
--
-- Each migration's own test proves its own table is closed. These prove the
-- rule for EVERY table, function and grant, so a new migration that forgets
-- one fails here even if its author wrote no test for it:
--
--   1. every table in public has row-level security on;
--   2. every SECURITY DEFINER function a client can call checks its caller;
--   3. every SECURITY DEFINER function in public pins its search_path;
--   4. anon holds no write grant on any table or view in public.
--
-- A failure lists the offenders by name. Widening an allowlist below is a
-- reviewed decision, like CLAUDE.md's rule for RLS changes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

-- 1.
select is(
  array(
    select c.relname::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
     order by 1),
  array[]::text[],
  'every table in public has row-level security on');

-- 2. A SECURITY DEFINER function bypasses RLS, so one that anon or
-- authenticated can call must check its caller itself. Supabase's default
-- privileges grant EXECUTE on every new public function to both roles, so
-- "nobody can call it" is not a safe assumption for any function.
--
-- "Checks its caller" is read from the source: it names one of the checks
-- below, or one of the internal lock helpers that open with one (0330, 0331).
-- The exceptions are reviewed, each for what it can show a signed-in caller:
--   policy helpers (active_alliance … tier_rank, and notification_channel_
--     alliance, 0200, which the outbox policy calls): who is asking, which
--     alliance a channel belongs to; nothing else;
--   joinable_alliances (0193): our own alliances' names, for the join form;
--   planner_building_ids (0286): building ids some account has shown, never
--     whose.
select is(
  array(
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.prorettype <> 'trigger'::regtype
       and (has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('authenticated', p.oid, 'execute'))
       and p.prosrc !~* '(current_app_role|has_permission|is_service_request|auth\.uid|auth\.role|errcode = ''42501''|internal\.[a-z_]+_lock\(|refuse_other_alliance|active_alliance\(\))'
       and p.proname not in (
         'active_alliance', 'current_app_role', 'has_permission',
         'is_service_request', 'primary_own_alliance', 'tier_rank',
         'notification_channel_alliance', 'joinable_alliances',
         'planner_building_ids')
     order by 1),
  array[]::text[],
  'every SECURITY DEFINER function anon or authenticated can call checks its caller');

-- 3.
select is(
  array(
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) as setting
          where setting like 'search_path=%')
     order by 1),
  array[]::text[],
  'every SECURITY DEFINER function in public sets search_path');

-- 4.
select is(
  array(
    select distinct format('%s (%s)', c.relname, privilege)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as privilege
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege('anon', c.oid, privilege)
     order by 1),
  array[]::text[],
  'anon cannot write to any table or view in public');

select * from finish();
rollback;
