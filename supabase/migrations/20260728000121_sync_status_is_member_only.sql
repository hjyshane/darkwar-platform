-- 0121: the last ungated view gets a gate.
--
-- `sync_status` was the one DEFINER view in `public` that did not ask who was
-- asking. 0060 justified that — it publishes a single heartbeat timestamp from
-- officer-only tables so the board can say whether it is live — and 0065 later
-- took `anon` off it, leaving exactly one gap: a signed-in VIEWER, somebody who
-- made an account and was never admitted, could read it.
--
-- THE GAP WAS NEVER WORTH ANYTHING TO THEM. `SyncStatus` only renders for a
-- member; a viewer sees the wall. So the exception bought no feature and cost
-- an entry in the one test that keeps definer views honest.
--
-- Closing it makes `58_relation_reach_test`'s rule absolute: every DEFINER view
-- granted to `authenticated` gates itself. A rule with no exceptions is one
-- nobody has to remember the shape of, and the named carve-out in that test
-- goes with this migration.
--
-- The gate is the same shape the other eight use — `current_app_role()` in the
-- WHERE clause, plus `is_service_request()` so the collector keeps its read
-- (0077's lesson: forgetting that disjunct is how a service account silently
-- loses a view and gets debugged months later).
create or replace view public.sync_status
with (security_invoker = false) as
select
  max(c.last_heartbeat_at) as last_heartbeat_at,
  max(c.last_heartbeat_at) > now() - interval '1 minute' as is_live
from public.collectors c
where public.current_app_role() in ('member', 'officer', 'admin')
   or public.is_service_request();

comment on view public.sync_status is
  'One fact: when a collector last checked in, and whether that was recent '
  'enough to call the board live. DEFINER because the tables underneath are '
  'officer-only and this is the single bit of them the alliance needs — with '
  'the member gate in the WHERE clause, the way post_authors does it. 0121 '
  'added that gate; before it, a signed-in viewer could read this.';

-- No grant change. 0060 granted select to anon and authenticated; 0065 removed
-- anon along with everything else, and `authenticated` is still right — the
-- WHERE clause is what decides, not the grant.
--
-- AN EMPTY ROW RATHER THAN NO ROW is what a viewer now gets: the aggregate
-- still returns one row with nulls in it, because `max()` over no rows is
-- null. The component reads `is_live` as false and says nothing, which is the
-- same thing it did for anybody whose collector had never checked in.

-- ---------------------------------------------------------------------------
-- AND THE TWO FUNCTIONS THAT NEVER GOT `SET search_path`.
-- ---------------------------------------------------------------------------
--
-- Everything written since carries `set search_path = ''`; these two predate
-- the convention and the linter still names them. Both bodies were already
-- fully schema-qualified, so this pins what they already did rather than
-- changing behaviour.
--
-- THE ESCALATION THE LINT WARNS ABOUT DOES NOT APPLY HERE, and it is worth
-- writing down so nobody "fixes" this twice. A mutable search_path is dangerous
-- on a SECURITY DEFINER routine: a caller points `search_path` at a schema
-- holding their own `reset_week_start`, and the definer runs it as the owner.
-- Both of these are INVOKER — a caller who redirected them would only be
-- running their own code as themselves. This is hardening and uniformity, not
-- a hole being closed.
--
-- IT COSTS INLINING, WHICH IS THE REAL TRADE. Postgres never inlines a function
-- carrying a SET clause, so `is_service_request()` stops folding into its
-- callers' WHERE clauses and becomes a call. It appears in eight view gates —
-- but every one of those already calls `current_app_role()`, which has had
-- `set search_path` since 0006 and has never been inlinable either. The second
-- call sits in the same OR as the first and touches no table, so this adds a
-- constant, not a per-row scan. That distinction is what 0100-0107 were about.
create or replace function public.is_service_request()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- NOT security definer, deliberately: a definer function runs as its owner and
  -- `current_user` would then always be that owner. This has to see who is
  -- actually asking.
  --
  -- `current_user` rather than the JWT claims, because Supabase's newer secret
  -- keys are not JWTs and set no claims at all — PostgREST still does
  -- `set local role service_role` for them, which is what this reads.
  select current_user in ('service_role', 'supabase_admin', 'postgres')
$$;

create or replace function public.rank_period_start(ts timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  -- Floor to an even number of game weeks from the epoch. The double modulo is
  -- deliberate: a date before the epoch makes the single one negative and the
  -- grid has to hold on both sides of it.
  select timestamptz '2026-08-03 02:00:00+00'
    + (
        (
          floor(
            extract(epoch from (
              public.reset_week_start(ts) - timestamptz '2026-08-03 02:00:00+00'
            )) / 604800
          )::bigint
          - ((floor(
              extract(epoch from (
                public.reset_week_start(ts) - timestamptz '2026-08-03 02:00:00+00'
              )) / 604800
            )::bigint % 2) + 2) % 2
        ) * interval '1 week'
      );
$$;
