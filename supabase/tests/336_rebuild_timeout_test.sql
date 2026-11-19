-- 0336: the function behind the Rebuild button carries its own statement
-- timeout, above the authenticated role's 8 s and under Supabase's 60 s cap.
--
-- Pinned because it is easy to lose without noticing: CREATE OR REPLACE
-- replaces a function's SET clauses with the new definition's, so a later
-- migration that re-creates `rebuild_rank_period` from an older body would
-- drop the line, and nothing would say so until an officer's Rebuild timed
-- out again. The timeout itself cannot be exercised here - the REST API is
-- what applies it - so the definition is what is asserted.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

create function pg_temp.config_of(fn regprocedure) returns text[]
language sql as $$
  select coalesce(proconfig, '{}') from pg_proc where oid = fn;
$$;

select ok(
  'statement_timeout=50s' = any (pg_temp.config_of(
    'public.rebuild_rank_period(timestamptz, boolean)'::regprocedure)),
  'rebuild_rank_period sets its own statement timeout of 50 s');

-- The limit is a number of seconds the REST API will honour: over the role's
-- 8 s, which is what was failing, and at most Supabase's 60 s for client
-- calls, past which the setting would be cut short elsewhere.
select cmp_ok(
  extract(epoch from (select split_part(c, '=', 2)
                      from unnest(pg_temp.config_of(
                        'public.rebuild_rank_period(timestamptz, boolean)'::regprocedure)) c
                      where c like 'statement_timeout=%')::interval),
  '>', 8::numeric,
  'and it is longer than the 8 s an authenticated call gets by default');
select cmp_ok(
  extract(epoch from (select split_part(c, '=', 2)
                      from unnest(pg_temp.config_of(
                        'public.rebuild_rank_period(timestamptz, boolean)'::regprocedure)) c
                      where c like 'statement_timeout=%')::interval),
  '<', 60::numeric,
  'and under the 60 s Supabase allows a client call');

-- The re-creation kept what 0196 had: the empty search_path a SECURITY
-- DEFINER function needs, and the definer itself.
select ok(
  'search_path=""' = any (pg_temp.config_of(
    'public.rebuild_rank_period(timestamptz, boolean)'::regprocedure)),
  'the empty search_path is still set');
select ok(
  (select prosecdef from pg_proc
    where oid = 'public.rebuild_rank_period(timestamptz, boolean)'::regprocedure),
  'and it is still SECURITY DEFINER');

select * from finish();
rollback;
