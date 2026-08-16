-- 0125: the names of the Discord channels, without the URLs.
--
-- 0124 lets an officer write the calendar, and a board on that calendar carries
-- the channel its reminders go to. But `notification_channels` is admin-only
-- INCLUDING select, because the row holds a webhook URL and a URL is a
-- credential — 0076 spends its header explaining exactly that.
--
-- So an officer could set `schedule_categories.channel` and had no way to find
-- out what to set it to. A dropdown that cannot be populated is not a feature
-- with a small gap in it; it is a form that can only be filled in by guessing,
-- with a foreign key waiting to reject the guess.
--
-- 0076 already answered whether the NAME is sensitive, in the other direction:
--
--   "The routing being world-readable is fine and mildly useful: a member can
--    see that departures are announced, without being able to announce one."
--
-- This is that sentence applied to the table the names live in. The view hands
-- over the name and whether it is switched on. It does not hand over the URL,
-- and it cannot: the column is not in it.
create view public.notification_channel_names
with (security_invoker = false) as
select
  channel,
  enabled
from public.notification_channels
where
  public.has_permission('schedule.manage')
  or public.current_app_role() = 'admin'
  or public.is_service_request();

comment on view public.notification_channel_names is
  'Channel NAMES only, for the board editor on the schedule screen. The '
  'webhook URL is a credential and stays in notification_channels, which is '
  'admin-only including select (0076); a name is routing, and 0076 says '
  'routing is fine to read.';

revoke all on public.notification_channel_names from anon;
grant select on public.notification_channel_names to authenticated;
