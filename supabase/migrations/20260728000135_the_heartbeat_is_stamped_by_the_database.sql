-- 0135: the sync badge stops flickering.
--
-- "Real-time sync stopped" appears for a poll or two and then clears itself,
-- over and over, on a collector that never stopped. Two separate things put it
-- there and both are in this file, because fixing either alone leaves the badge
-- wrong in a way that looks like the same bug.
--
-- ---------------------------------------------------------- the wrong clock
--
-- `collectors.last_heartbeat_at` is written by the collector, with the
-- collector's own idea of the time: `heartbeat.report()` sends
-- `datetime.now(UTC).isoformat()` in the PATCH body. `sync_status` then
-- compares that value against the DATABASE's `now()`.
--
-- So the margin is not a margin at all. Every second the Windows box's clock
-- runs slow is a second taken off the window before the badge calls the board
-- dead, and a home machine that has not talked to a time server in a while can
-- be most of a minute out without anything else noticing. The collector says
-- "I beat at 19:42:03", the database reads it at 19:42:47, and a beat that was
-- four seconds old arrives looking forty-four.
--
-- Nothing else on this row has that problem, because nothing else on it is
-- compared against server time. `last_packet_at` describes when a packet was
-- seen on that machine and is only ever read as an age; `reported_at` on the
-- history row is deliberately what the collector THOUGHT, and stays that way —
-- a heartbeat history that cannot show a skewed clock is a history that cannot
-- diagnose one.
--
-- The trigger stamps only when the writer actually supplied a beat. A PATCH
-- that changes a collector's name leaves `last_heartbeat_at` alone, so it stays
-- distinct-from-old only when a heartbeat is what happened, and an admin
-- renaming a machine does not make it look alive.
create function public.stamp_heartbeat()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- INSERT: registration may carry a first beat. Same rule — if it is there,
  -- it is ours to stamp.
  if tg_op = 'INSERT' then
    if new.last_heartbeat_at is not null then
      new.last_heartbeat_at := now();
    end if;
    return new;
  end if;

  -- UPDATE: only when the beat itself moved. `is distinct from` rather than
  -- `<>` because either side may be null — a first beat arrives against a null
  -- and must still stamp.
  if new.last_heartbeat_at is distinct from old.last_heartbeat_at then
    new.last_heartbeat_at := now();
  end if;
  return new;
end;
$$;

comment on function public.stamp_heartbeat() is
  'Replaces a collector-supplied last_heartbeat_at with server time, so '
  'sync_status compares one clock against itself. Only fires when the write '
  'actually carried a beat; renaming a collector does not revive it.';

create trigger stamp_heartbeat
  before insert or update on public.collectors
  for each row execute function public.stamp_heartbeat();

-- ------------------------------------------------------- the wrong threshold
--
-- One minute was never a minute of slack either. `dw-sync` beats from inside
-- the same serial loop that drains the outbox:
--
--     drain_once()  →  report health  →  sleep(DW_SYNC_INTERVAL_SECONDS)
--
-- so the gap between beats is the drain time PLUS the interval, not the
-- interval. A default ten-second loop that spends fifty seconds shipping a
-- backlog produces a sixty-second gap, and the badge calls that an outage. A
-- heartbeat POST that fails is logged and skipped entirely, which costs a whole
-- further interval on its own.
--
-- Three minutes. Long enough that an ordinary slow drain, or a skipped beat, or
-- both together, stay inside it; short enough to still be the fast indicator
-- this is for. It does not move the alarm: `internal.detect_sync_stalled()`
-- (0130) waits ten minutes before saying anything in Discord, and that gap
-- between "the dot went grey" and "somebody is told" is the point of having
-- two thresholds rather than one.
--
-- 0130 predicted this line: "The dashboard calls the board stale after one; a
-- badge may flicker and a Discord message may not."
create or replace view public.sync_status
with (security_invoker = false) as
select
  max(c.last_heartbeat_at) as last_heartbeat_at,
  max(c.last_heartbeat_at) > now() - interval '3 minutes' as is_live
from public.collectors c
where public.current_app_role() in ('member', 'officer', 'admin')
   or public.is_service_request();

comment on view public.sync_status is
  'One fact: when a collector last checked in, and whether that was recent '
  'enough to call the board live. Three minutes (0135), because dw-sync beats '
  'after each outbox drain rather than on a fixed cadence. The timestamp is '
  'stamped by the database (0135), so this compares server time against '
  'itself. DEFINER because the tables underneath are officer-only and this is '
  'the single bit of them the alliance needs, with the member gate in the '
  'WHERE clause; 0121 added that gate.';
