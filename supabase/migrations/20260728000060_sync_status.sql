-- 0060: is the collector still running, for everyone who reads the board.
--
-- `collectors` and `collector_heartbeats` are officer-only, and rightly:
-- version, outbox depth and packet age are operational detail. But "the
-- figures on this screen stopped updating twenty minutes ago" is not
-- operational detail — it is the most important thing about the figures, and
-- a member reading a stale roster needs it as much as an officer does.
--
-- So this view exposes ONE fact and nothing else: when the last heartbeat
-- arrived. It leaks nothing that captured_at on the snapshot tables does not
-- already say out loud.
--
-- The threshold lives here rather than in the dashboard so that "live" means
-- one thing. dw-sync beats every DW_SYNC_INTERVAL_SECONDS, default 10, so a
-- minute of silence is six missed beats — long enough not to flicker over a
-- slow round trip, short enough that somebody watching notices.
create view public.sync_status
with (security_invoker = false) as
select
  max(last_heartbeat_at) as last_heartbeat_at,
  max(last_heartbeat_at) > now() - interval '1 minute' as is_live
from public.collectors;

comment on view public.sync_status is
  'One fact: when a collector last checked in, and whether that was recent '
  'enough to call the board live. Deliberately NOT security_invoker — the '
  'tables underneath are officer-only and this is the one bit of them '
  'everybody needs. Nothing else from those tables is exposed here.';

grant select on public.sync_status to anon, authenticated;
