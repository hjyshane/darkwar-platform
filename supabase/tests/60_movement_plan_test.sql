-- rank_period_movement must compute its predecessor period once, not per member.
--
-- 51_rank_movement_test pins what the view ANSWERS. Nothing pinned what it
-- COST, and the cost is what broke: under RLS the planner cannot estimate the
-- `member_read` qual (`current_app_role()` is SECURITY DEFINER with a SET
-- clause — opaque by design), every row estimate collapses to 1, and the
-- "most recent earlier period at the same scoring version" subquery landed on
-- the inner side of a nested loop, re-running once per member. 96 members
-- meant ~9,700 executions of the RLS qual and 3 seconds on production — the
-- statement timeout the members screen kept reporting as a 500 (#171).
--
-- Asserting on the plan rather than a stopwatch, the same reasoning as
-- 59_growth_pushdown_test. The fix is not a better estimate — the qual stays
-- opaque — it is a fence: 0100 puts every read of `rank_period_snapshots`
-- behind AS MATERIALIZED, which pins each to one execution whatever the
-- planner believes. A materialised CTE shows up in the plan as its own
-- `CTE <name>` subplan under any role and any table size, so the assertions
-- below need no fixture rows and no member session. Checked red: against
-- 0088's definition, only `CTE newest` appears (referenced three times, so
-- auto-materialised) and 1–3 fail; `prior`, `latest` and `previous` are
-- inlined into the join tree, which is exactly where the re-execution lived.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

create function pg_temp.plan_for(sql text) returns text language plpgsql as $$
declare
  line text;
  out text := '';
begin
  for line in execute 'explain (costs off) ' || sql loop
    out := out || line || E'\n';
  end loop;
  return out;
end;
$$;

-- 1-3. The fences. Each of these is a read of rank_period_snapshots that 0088
-- left inlined; if a rewrite drops a fence, its CTE node disappears from the
-- plan and the re-execution can come back without any answer changing.
select matches(
  pg_temp.plan_for('select * from public.rank_period_movement'),
  'CTE prior',
  'the predecessor period is computed behind a materialisation fence');

select matches(
  pg_temp.plan_for('select * from public.rank_period_movement'),
  'CTE latest',
  'the newest period''s rows are read once, behind a fence');

select matches(
  pg_temp.plan_for('select * from public.rank_period_movement'),
  'CTE previous',
  'the predecessor''s rows are read once, behind a fence');

-- 4. And the join above the fences consumes the CTEs rather than reaching
-- around them. Four fenced reads is the whole budget; a fifth scan of the
-- table in the plan means somebody is reading it outside a fence.
select is(
  (length(pg_temp.plan_for('select * from public.rank_period_movement'))
   - length(replace(pg_temp.plan_for('select * from public.rank_period_movement'),
                    'on rank_period_snapshots', ''))
  ) / length('on rank_period_snapshots'),
  4,
  'exactly four reads of rank_period_snapshots, one per fence');

-- 5. Still security_invoker. The fences must not cost the view its RLS: it
-- reads a member-only table, and a rewrite that dropped the setting would hand
-- every authenticated reader the rank history (the 0097 failure mode).
select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'rank_period_movement'
        and (c.reloptions is null
             or c.reloptions::text !~ 'security_invoker=(true|on)') $$,
  'rank_period_movement still reads with the caller''s rights');

select * from finish();
rollback;
