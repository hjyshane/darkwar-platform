-- 0095: `record_departure()` was reachable by anon.
--
-- 0094 wrote `revoke all on function public.record_departure(uuid, text)
-- from public;` and stopped there, which is the pattern the rest of this
-- schema uses. It is not enough on Supabase.
--
-- The platform ships
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
--
-- so every function created here is granted to `anon` and `authenticated`
-- DIRECTLY at creation. Revoking from `public` does not touch a direct grant
-- to a named role, so the revoke ran, reported success, and left EXECUTE in
-- place. `supabase db diff --linked` is what showed it: the grants appear as
-- remote state with no migration behind them.
--
-- Its two callers are unaffected. Both are SECURITY DEFINER and execute as
-- the owner, which needs no grant.
--
-- The other two functions 0094 added were already safe, and only because
-- each opens with its own check — `leave_alliance()` refuses a null
-- `auth.uid()`, `remove_member()` refuses without `members.manage`. That is
-- the right way round: a function's guard should not be its grant. But
-- `record_departure()` has no guard, because it was never meant to be
-- callable. Unrevoked, an anonymous request could write arbitrary rows into
-- `audit_logs` — the one table whose value is that its rows are true.
--
-- LESSON, and it is not about this function. On this platform `revoke ...
-- from public` does not make a function private. Naming the roles does.
revoke all on function public.record_departure(uuid, text) from anon, authenticated;

comment on function public.record_departure is
  'Internal to leave_alliance() and remove_member(). Deliberately granted to '
  'nobody: it has no permission check of its own, because it is never meant '
  'to be reached from outside a SECURITY DEFINER caller.';
