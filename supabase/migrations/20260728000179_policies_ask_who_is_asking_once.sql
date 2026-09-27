-- 0179: every policy asks who is asking once per statement, not once per row.
--
-- THE DISEASE 0100 NAMED, TREATED AT THE SOURCE. 0100, 0103, 0104 and 0105
-- each found the same thing in a different view: `current_app_role()` is a
-- SECURITY DEFINER sql function, so the planner cannot inline it, and an RLS
-- qual that calls it bare is evaluated for every row the scan touches. Each
-- of those migrations treated one view. None touched the policies, and the
-- policies are where the call lives — 66 bare calls across the schema, zero
-- wrapped.
--
-- Wrapping a view as DEFINER does not escape it on the hosted project: the
-- hosted `postgres` is not a superuser, so RLS quals still run under a
-- definer view (0105; memory "hosted definer views keep RLS"). The only fix
-- that reaches every reader is the qual itself.
--
-- THE FIX IS THE ONE SUPABASE DOCUMENTS: `(select f())` instead of `f()`.
-- A scalar subquery with no reference to the outer row is planned as an
-- InitPlan — evaluated once, its result reused for every row. The function,
-- its answer and every policy's meaning are unchanged; only how often it
-- runs changes.
--
-- WHAT PROMPTED IT, measured 2026-09-27. The trends tab timed out for members
-- ("board history failed: canceling statement due to statement timeout")
-- while the same three queries took 0.09-1.3 s as service_role, which
-- bypasses RLS. `alliance_power_history` reads, per reading of an alliance,
-- the ~100 rows of that reading's board (0153's lateral). For CBFW that is
-- 1,071 readings x ~100 rows, each through `alliance_snapshots`' policy —
-- about 107,000 role lookups for one chart. The user reports the timeout
-- "in various tabs": every member-only table carries the same qual.
--
-- WHAT IS WRAPPED. Only calls whose answer cannot depend on the row:
--   public.current_app_role()          no arguments
--   public.linked_player_id()          no arguments
--   public.is_service_request()        no arguments
--   public.has_permission('<literal>') a constant argument
-- A call that took a column would have to stay per-row; there is none today,
-- and the regex below only matches a string literal argument, so one added
-- later is left alone rather than wrapped wrongly.
--
-- HOW. Each policy's expression is deparsed with an empty search_path, so
-- every name comes back schema-qualified and casts come back as
-- `::public.app_role` — text that re-parses to the same expression under any
-- search_path. An already-wrapped call deparses as `(SELECT public.f() ...`,
-- and the lookbehind skips it, so running this twice changes nothing.
--
-- Scope is the public schema. storage.objects policies (0049) are owned by
-- the storage role and are not this migration's to alter.
do $$
declare
  p record;
  new_qual text;
  new_check text;
  wrapped constant text :=
    '(?<!SELECT )(public\.(current_app_role|linked_player_id|is_service_request)\(\)'
    || '|public\.has_permission\(''[^'']*''::text\))';
begin
  perform set_config('search_path', '', true);

  for p in
    select pol.polname, c.relname,
           pg_get_expr(pol.polqual, pol.polrelid)      as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
  loop
    new_qual := regexp_replace(p.qual, wrapped, '(SELECT \1)', 'g');
    new_check := regexp_replace(p.with_check, wrapped, '(SELECT \1)', 'g');

    if new_qual is distinct from p.qual then
      execute format('alter policy %I on public.%I using (%s)', p.polname, p.relname, new_qual);
    end if;
    if new_check is distinct from p.with_check then
      execute format('alter policy %I on public.%I with check (%s)',
                     p.polname, p.relname, new_check);
    end if;
  end loop;
end
$$;
