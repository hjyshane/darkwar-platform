-- 0127: a notice or a guide says where it announces.
--
-- Routing has been per EVENT since 0076: every guide went to one channel and
-- every notice to another, chosen once in settings. That is the right default
-- and the wrong ceiling — "the dashboard is down tonight" and "here is the war
-- plan for Saturday" are both notices and belong in different rooms.
--
-- SAME SHAPE AS 0124'S BOARDS, deliberately. The row carries a channel NAME,
-- the notifier falls back to the settings channel when it is null, and the URL
-- stays in `notification_channels` where only an admin can read it. Three
-- features now route the same way, which is one rule to remember rather than
-- three.
--
-- Null is not "unset waiting to be filled in" — it is "wherever this kind of
-- post normally goes", which is what almost every post wants.
alter table public.announcements
  add column channel text references public.notification_channels (channel) on delete set null;

alter table public.guides
  add column channel text references public.notification_channels (channel) on delete set null;

comment on column public.announcements.channel is
  'Which Discord channel this notice announces in, or null for the channel '
  'set for notices in settings. A NAME, never a URL (0076).';

comment on column public.guides.channel is
  'Which Discord channel this guide announces in, or null for the channel set '
  'for guides in settings. A NAME, never a URL (0076).';

-- 0125 exposed the channel names to whoever could manage the schedule, because
-- that was the only screen that needed them. Two more screens need them now.
--
-- WIDENED BY CAPABILITY, not to everybody. A member who cannot write a post has
-- no use for the list, and the names are readable-not-secret rather than
-- public — 0076's point was that routing is fine for a WRITER to see, not that
-- it belongs on the roster screen.
create or replace view public.notification_channel_names
with (security_invoker = false) as
select
  channel,
  enabled
from public.notification_channels
where
  public.has_permission('schedule.manage')
  or public.has_permission('announcement.write')
  or public.has_permission('guide.write')
  or public.current_app_role() = 'admin'
  or public.is_service_request();

comment on view public.notification_channel_names is
  'Channel NAMES only, for the editors that choose where a post announces. The '
  'webhook URL is a credential and stays in notification_channels, which is '
  'admin-only including select (0076); a name is routing, and 0076 says '
  'routing is fine for a writer to read.';
