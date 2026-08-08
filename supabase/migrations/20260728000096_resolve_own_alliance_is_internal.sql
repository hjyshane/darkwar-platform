-- 0096: `resolve_own_alliance()` was an unauthenticated write endpoint.
--
-- Found by sweeping every function `anon` may execute, after 0095 showed that
-- the platform's default privileges quietly open new ones. This is the other
-- half of the same class, arrived at from the opposite direction: 0095's
-- function was revoked from `public` and re-opened by a direct grant to
-- `anon`; this one was never revoked at all.
--
-- `CREATE FUNCTION` grants EXECUTE to PUBLIC by default in Postgres, and
-- `anon` is in PUBLIC. 0032 added this function with no revoke, so it has
-- been callable by an anonymous request since — locally as well as in
-- production, which is why this one has a test that can actually fail.
--
-- What it does is UPDATE `public.alliances.is_own`. It takes no arguments and
-- recomputes from the pin and the roster evidence, so a caller cannot choose
-- the outcome, cannot read anything back (it returns void), and cannot
-- escalate. What they can do is make the database write, and make every
-- dashboard connected to realtime refetch, as often as they like.
--
-- That is a small hole. It is still a hole, and the reason to close it is not
-- its size: nothing about this function's body announces that it is only ever
-- meant to run from a trigger, so the next person to read it has no reason to
-- think an anonymous caller is a problem.
--
-- Both callers are SECURITY DEFINER triggers — `app_settings_resolve()` when
-- the pin changes, `apply_roster_summary()` when a roster lands. They execute
-- as the owner and need no grant, so this breaks neither.
--
-- Revoked from `public` AND from the two roles by name. Either alone would
-- have left it open: `public` misses the platform's direct grants (0095), and
-- naming the roles misses the PUBLIC default (this one).
revoke all on function public.resolve_own_alliance() from public, anon, authenticated;

comment on function public.resolve_own_alliance is
  'Recompute alliances.is_own from the admin pin, falling back to what the '
  'rosters show. Called by apply_roster_summary and by the settings trigger, '
  'so the two inputs cannot drift apart. Granted to nobody: it has no '
  'permission check of its own and is never meant to be called directly.';
