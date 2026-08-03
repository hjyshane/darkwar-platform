-- 0055: give player_power_growth its grant back.
--
-- 0051 dropped and recreated the view to move a column, and a recreated view
-- is a NEW object with no privileges — the grant 0049 made died with the old
-- one. Nothing failed at migration time; the Members tab simply started
-- answering 403 "permission denied for view player_power_growth" on every
-- load, and the roster query throws on it, so the whole tab went with it.
--
-- This is 0032's lesson in a different costume: a policy or a view without
-- the matching grant refuses everybody, and refusing everybody is
-- indistinguishable from working until somebody looks. 29_growth_test now
-- asserts a member can actually read it, which is the assertion that would
-- have caught this at the point it was introduced.
grant select on public.player_power_growth to anon, authenticated;

-- And a correction to what 0049 and 0051 claim about it.
--
-- Both say the view is security_invoker "because player_snapshots is
-- member-only and a view reading it with the owner's rights would hand a
-- logged-out visitor every member's power history". The first half of that
-- is false. player_snapshots carries `public_read USING (true)` and always
-- has — the cross-server boards are readable logged out, and they are that
-- table. Power history is public already.
--
-- security_invoker is still right, for the reason that survives: a view can
-- then never hand out more than its caller could fetch directly, whatever
-- the tables underneath are policied as later. But a comment asserting a
-- protection that does not exist is worse than no comment, so this is here
-- rather than left to be believed.
comment on view public.player_power_growth is
  'Power at the most recent 02:05 UTC, against the same point a day and a '
  'week earlier. Fixed measurement times so the figure holds still for a '
  'day; baseline timestamps come with it because the collector may not have '
  'run at the moment asked for. Readable by anyone, because the snapshots '
  'underneath are — security_invoker keeps it that way rather than more.';
