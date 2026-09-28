-- 0187: the five definer views 0185 did not see.
--
-- 0185 compared production against the migrations that say
-- `security_invoker = false` out loud. Five views say nothing at all, and saying
-- nothing is definer: a `create [or replace] view` with no WITH clause leaves
-- the view with no reloptions, so the owner's rights apply. Production has all
-- five as `security_invoker=true`. Their bodies are still the migrations'
-- bodies, so they were flipped in place, the same drift 0185 repaired.
--
--   | view                    | defined last in | its gate (top-level WHERE)       |
--   |-------------------------|-----------------|----------------------------------|
--   | alliance_departures     | 0152            | member+ or service               |
--   | alliance_roster_latest  | 0152            | member+ or service               |
--   | alliance_roster_history | 0077            | member+ or service               |
--   | event_scoreboard        | 0120            | member+                          |
--   | app_user_directory      | 0069            | has_permission('members.manage') |
--
-- Every one of them was written definer on purpose, with its own gate in the
-- WHERE clause, and production's copies still carry those gates (checked on
-- 2026-09-27 before writing this). As invoker they go wrong in different ways:
--
--   - app_user_directory joins auth.users, which authenticated cannot read at
--     all. As invoker the members screen's directory fails outright for the
--     admins it exists for.
--   - event_scoreboard exists to show everybody's standing. 0120 spent a
--     whole paragraph on why invoker returns only the caller's own row.
--   - the three roster views read alliance_member_snapshots. As invoker they
--     answer through the caller's RLS on that table (0066 narrowed member
--     history to own-or-officer) and 0016's column grants, instead of the
--     member gate their migrations chose. A member's roster shrinks toward
--     their own rows.
--
-- ALTER only, as in 0185: nothing is recreated, nothing is granted, and on a
-- database built from these migrations every statement is a no-op.
alter view public.alliance_departures set (security_invoker = false);
alter view public.alliance_roster_latest set (security_invoker = false);
alter view public.alliance_roster_history set (security_invoker = false);
alter view public.event_scoreboard set (security_invoker = false);
alter view public.app_user_directory set (security_invoker = false);
