-- 0327: say so when a time that already had an alarm moves.
--
-- The alarms of 0323 follow the entry: a real move sends the steps again for
-- the new time. What nobody learns from that is that the earlier message was
-- wrong. So when an entry's time moves by 2 minutes or more AFTER at least one
-- of its alarms reached Discord, one short follow-up goes out, pinging the same
-- role. Every writer of starts_at / ends_at passes through here: officers in the
-- tab, the calendar job (0325) and the in-place move of an alliance pick (0326).
--
-- It is not an alarm step: alarm_step and anchor_at stay null, so
-- public.alarm_deliveries (0324) ignores it. It lapses after 15 minutes like
-- any alarm, and it is keyed by the new times so the same move is one notice.

create or replace function internal.announce_alarm_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat public.schedule_categories%rowtype;
  v_channel text;
  v_s bigint;
  v_e bigint;
begin
  begin
    if new.hidden then
      return null;
    end if;

    if not (abs(extract(epoch from new.starts_at - old.starts_at)) >= 120
            or (new.ends_at is distinct from old.ends_at
                and (new.ends_at is null or old.ends_at is null
                     or abs(extract(epoch from new.ends_at - old.ends_at)) >= 120))) then
      return null;
    end if;

    if not exists (
      select 1 from public.notification_outbox o
       where o.schedule_event_id = new.schedule_event_id
         and o.idempotency_key like 'alarm:%'
         and o.delivered_at is not null) then
      return null;
    end if;

    select * into v_cat
      from public.schedule_categories c
     where c.category = new.category
       and c.alliance_id is not distinct from new.alliance_id;

    v_channel := internal.alarm_route(new.alliance_id, v_cat.channel);
    if v_channel is null then
      return null;
    end if;

    v_s := extract(epoch from new.starts_at)::bigint;
    v_e := extract(epoch from new.ends_at)::bigint;

    insert into public.notification_outbox
      (channel, event, idempotency_key, title, body, ping_role_id, expires_at, schedule_event_id)
    values (
      v_channel,
      'schedule_reminder',
      'alarm-moved:' || new.schedule_event_id || ':' || v_s || ':' || coalesce(v_e::text, 'none'),
      left(new.title, 256),
      '**' || new.title || ' moved** — now <t:' || v_s || ':F>'
        || case when v_cat.kind = 'window' and v_e is not null
                then ' to <t:' || v_e || ':F>'
                else ' (<t:' || v_s || ':R>)' end,
      v_cat.ping_role_id,
      now() + interval '15 minutes',
      new.schedule_event_id)
    on conflict (idempotency_key) do nothing;
  exception when others then
    raise warning 'announce_alarm_move failed for %: %', new.schedule_event_id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function internal.announce_alarm_move() from public, anon, authenticated;

comment on function internal.announce_alarm_move() is
  'After a time moves by 2+ minutes and an alarm already reached Discord, queue '
  'one short "moved" notice (not an alarm step; lapses in 15 minutes). Warns, '
  'never raises: a failed notice must not block the edit.';

create trigger schedule_events_moved
  after update of starts_at, ends_at on public.schedule_events
  for each row execute function internal.announce_alarm_move();
