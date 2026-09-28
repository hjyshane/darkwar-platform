-- 0185: put seven views back the way their migrations left them.
--
-- The player page's hero-and-pet chart answered
--   permission denied for view player_component_power_history
-- for every member. The repo was not the cause: 0086 grants SELECT to
-- authenticated, 0099 and 0104 are `create or replace` (which keeps the ACL),
-- and 63_component_history_test reads the view as an authenticated member and
-- asserts it is a definer view. Production had drifted from all of that outside
-- any migration. Read from the catalog on 2026-09-27:
--
--   relacl      {postgres=..., service_role=...}      -- authenticated gone
--   reloptions  {security_invoker=true}               -- 0104 says false
--
-- while the view body and its comment were still 0104's, so the view had not
-- been recreated: its options were flipped and its grant revoked in place. That
-- is the shape of the hosted Security Advisor's one-click fixes, and nothing
-- here can say who ran them.
--
-- The same sweep of every view in `public` found six more in the same state,
-- each diverging from the migration that last defined it:
--
--   | view                       | repo                         | production    |
--   |----------------------------|------------------------------|---------------|
--   | player_component_power_history | definer (0104), grant (0086) | invoker, none |
--   | pending_access             | grant authenticated (0123)   | no grant      |
--   | app_user_directory         | grant authenticated (0069)   | no grant      |
--   | alliance_departures        | grant authenticated (0067)   | no grant      |
--   | post_authors               | grant authenticated (0113)   | no grant      |
--   | sync_status                | definer (0135)               | invoker       |
--   | notification_channel_names | definer (0127)               | invoker       |
--
-- A missing grant is a hard 42501 for every member. A definer view flipped to
-- invoker is quieter and worse: it answers, but through the RLS of the caller,
-- so it returns fewer rows than it was written to — or, for the component
-- history, falls back into the per-row current_app_role() cost 0104 removed.
-- Every definer view here carries its own role gate in its WHERE; that gate,
-- not the caller's RLS, is what each migration designed and its test pins.
--
-- None of this reaches anon. 0168 closed public to anon and nothing below
-- reopens it.
--
-- Stated as ALTER and GRANT rather than recreates: the bodies in production are
-- the right ones, and every statement is a no-op on a database that never
-- drifted.

-- Definer again.
alter view public.player_component_power_history set (security_invoker = false);
alter view public.sync_status set (security_invoker = false);
alter view public.notification_channel_names set (security_invoker = false);

-- Readable by members again.
grant select on public.player_component_power_history to authenticated;
grant select on public.pending_access to authenticated;
grant select on public.app_user_directory to authenticated;
grant select on public.alliance_departures to authenticated;
grant select on public.post_authors to authenticated;
