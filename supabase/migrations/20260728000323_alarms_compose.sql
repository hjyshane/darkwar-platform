-- 0323: what an alarm says, where it goes, and that each step goes out once.
--
-- Second of six steps turning the schedule tables into Discord event alarms
-- (docs/superpowers/specs/2026-11-14-event-alarms-design.md §1, §4, §6, §7).
--
--   * THE TEXT is composed at send time from the entry's CURRENT times: the
--     officer's message (else the board's template) with {start}/{in}/{end}
--     rendered as Discord timestamps, then one generated line that is always
--     there ("Starts …", "Open now — closes …", "Closes …"). Discord renders
--     <t:…> in each reader's zone and R as a live countdown, so nothing says
--     "in 720 minutes" when the minute job ran late. The description is cut to
--     Discord's 4,096 at the MESSAGE end, so the time line always survives.
--   * THE ROUTE (§1): the board's channel when it belongs to the entry's
--     alliance, else the alliance's schedule_reminder routing, else nothing.
--     0199 sent nothing at all when that routing was off, even to a board
--     with a channel of its own; a board channel now works by itself.
--   * ONCE (§7): the key names the entry, the step and the anchor time, never
--     the reminder row, so a re-saved reminder cannot send twice and a moved
--     time sends again at the new time. A calendar re-read nudging a time by
--     under 2 minutes is jitter: a step already sent for an anchor within 2
--     minutes is not sent again, although its key would differ.
--
-- Same name and cron tick as before (0131): detect_schedule_reminders().

-- ------------------------------------------------------------------ the text

-- Placeholders in an officer's message. Whole Unix seconds.
create function internal.alarm_render(p_text text, p_starts timestamptz, p_ends timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(p_text,
    '{start}', coalesce('<t:' || extract(epoch from p_starts)::bigint || ':F>', '')),
    '{in}',    coalesce('<t:' || extract(epoch from p_starts)::bigint || ':R>', '')),
    '{end}',   coalesce('<t:' || extract(epoch from p_ends)::bigint || ':F>', ''))
$$;

revoke execute on function internal.alarm_render(text, timestamptz, timestamptz)
  from public, anon, authenticated;

-- The generated line. A one-off (p_send_at) on a window says what is next from
-- where it lands: "Opens" before the start, "Closes" after. A window with no
-- end (typed by hand) can still open; with no close to name, its line is just
-- "Open now" — never null, because a null body would fail the whole minute
-- tick (0131 runs every detector and the deliverer in one statement).
create function internal.alarm_line(
  p_kind text, p_anchor text, p_minutes int, p_send_at timestamptz,
  p_starts timestamptz, p_ends timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_kind, 'point') = 'point' and p_anchor = 'start'
      then 'Starts ' || s.f || ' (' || s.r || ')'
    when p_send_at is not null and p_send_at < p_starts
      then 'Opens ' || s.f || ' (' || s.r || ')'
    when p_send_at is null and p_anchor = 'start' and p_minutes > 0
      then 'Opens ' || s.f || ' (' || s.r || ')'
    when p_send_at is null and p_anchor = 'start'
      then 'Open now' || coalesce(' — closes ' || e.f || ' (' || e.r || ')', '')
    else coalesce('Closes ' || e.f || ' (' || e.r || ')', 'Open now')
  end
  from (select '<t:' || extract(epoch from p_starts)::bigint || ':F>' as f,
               '<t:' || extract(epoch from p_starts)::bigint || ':R>' as r) s,
       (select '<t:' || extract(epoch from p_ends)::bigint || ':F>' as f,
               '<t:' || extract(epoch from p_ends)::bigint || ':R>' as r) e
$$;

revoke execute on function internal.alarm_line(text, text, int, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

-- Message, blank line, the generated line; at most Discord's 4,096 characters.
create function internal.alarm_description(p_message text, p_line text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(btrim(p_message), '') = '' then p_line
    when length(p_message) + 2 + length(p_line) <= 4096
      then p_message || E'\n\n' || p_line
    else left(p_message, 4096 - 2 - length(p_line) - 1) || '…' || E'\n\n' || p_line
  end
$$;

revoke execute on function internal.alarm_description(text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------- the route

-- 0199's test that a board channel is the alliance's own, unchanged.
create function internal.alarm_route(p_alliance uuid, p_board_channel text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select n.channel from public.notification_channels n
      where n.channel = p_board_channel
        and coalesce(n.alliance_id, public.primary_own_alliance())
            is not distinct from coalesce(p_alliance, public.primary_own_alliance())),
    internal.alert_channel('schedule_reminder', p_alliance))
$$;

revoke execute on function internal.alarm_route(uuid, text) from public, anon, authenticated;

comment on function internal.alarm_route(uuid, text) is
  'Where an alarm of this alliance goes: the board''s channel when it is the '
  'alliance''s own, else its schedule_reminder routing, else null (nothing is sent).';

-- ------------------------------------------------------------------ the view

-- 0203's body with the alarm settings beside it. Dropped, not replaced: the
-- new columns do not all go at the end. `channel` stays the BOARD's channel.
drop view public.schedule_reminders_due;

create view public.schedule_reminders_due
with (security_invoker = true) as
select
  r.reminder_id,
  r.schedule_event_id,
  r.anchor,
  r.minutes_before,
  r.send_at,
  r.enabled,
  e.title,
  e.alarm_message,
  e.starts_at,
  e.ends_at,
  case r.anchor when 'start' then e.starts_at else e.ends_at end as anchor_at,
  coalesce(r.send_at,
           case r.anchor when 'start' then e.starts_at else e.ends_at end
             - make_interval(mins => r.minutes_before)) as fire_at,
  e.category,
  c.label as category_label,
  c.channel,
  c.kind,
  c.message_template,
  c.ping_role_id,
  e.alliance_id,
  e.hidden
from public.schedule_reminders r
join public.schedule_events e using (schedule_event_id)
left join public.schedule_categories c
  on c.category = e.category
 and c.alliance_id is not distinct from e.alliance_id;

comment on view public.schedule_reminders_due is
  'Every reminder with the time it is anchored to (anchor_at: the entry''s '
  'start or end), the moment it should be said (fire_at) and its board''s '
  'channel and alarm settings. Does NOT decide which are due. security_invoker '
  'because the tables under it carry real RLS policies (0124).';

-- 0124's grant. Prod's default privileges give authenticated more than that on
-- a new relation, so revoke first.
revoke all on public.schedule_reminders_due from public, anon, authenticated;
grant select on public.schedule_reminders_due to authenticated;

-- --------------------------------------------------------------- the detector

create or replace function internal.detect_schedule_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written int := 0;
begin
  insert into public.notification_outbox
    (channel, event, idempotency_key, title, body, ping_role_id, expires_at,
     schedule_event_id, alarm_step, anchor_at)
  select
    rt.channel,
    'schedule_reminder',
    'alarm:' || d.schedule_event_id || ':' || d.anchor || ':'
      || coalesce(d.minutes_before::text, extract(epoch from d.send_at)::bigint::text)
      || ':' || extract(epoch from d.anchor_at)::bigint,
    left(d.title, 256),
    internal.alarm_description(
      internal.alarm_render(coalesce(d.alarm_message, d.message_template), d.starts_at, d.ends_at),
      internal.alarm_line(d.kind, d.anchor, d.minutes_before, d.send_at, d.starts_at, d.ends_at)),
    d.ping_role_id,
    d.fire_at + interval '15 minutes',
    d.schedule_event_id,
    st.step,
    d.anchor_at
  from public.schedule_reminders_due d
  cross join lateral (
    select internal.alarm_route(d.alliance_id, d.channel) as channel
  ) rt
  cross join lateral (
    select case when d.send_at is not null
                then 'once:' || extract(epoch from d.send_at)::bigint
                else d.anchor || ':' || d.minutes_before end as step
  ) st
  where d.enabled
    and not d.hidden
    and d.anchor_at is not null
    and d.fire_at <= now()
    and d.fire_at > now() - interval '15 minutes'
    and rt.channel is not null
    -- Sent already for (nearly) this time: a move under 2 minutes is jitter.
    and not exists (
      select 1 from public.notification_outbox o
       where o.schedule_event_id = d.schedule_event_id
         and o.alarm_step = st.step
         and o.anchor_at > d.anchor_at - interval '2 minutes'
         and o.anchor_at < d.anchor_at + interval '2 minutes')
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- ---------------------------------------------- what the old detector sent

-- 0199 keyed a send by reminder row and start time and recorded neither entry
-- nor step, so the check above cannot see it: a step it sent shortly before
-- this deploy would go out again under the new key. Its recent rows are tagged
-- with what they were — every step was a start step then. A function rather
-- than a bare UPDATE so the test can run it on a row it wrote.
create function internal.adopt_legacy_reminder_sends()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  update public.notification_outbox o
     set schedule_event_id = r.schedule_event_id,
         alarm_step = 'start:' || r.minutes_before,
         anchor_at = (regexp_match(o.idempotency_key,
                        '^schedule_reminder:[0-9a-f-]{36}:(.+)$'))[1]::timestamptz
    from public.schedule_reminders r
   where o.idempotency_key like 'schedule_reminder:%'
     and o.created_at > now() - interval '1 day'
     and o.schedule_event_id is null
     and r.minutes_before is not null
     and r.reminder_id::text = split_part(o.idempotency_key, ':', 2);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function internal.adopt_legacy_reminder_sends() from public, anon, authenticated;

select internal.adopt_legacy_reminder_sends();
