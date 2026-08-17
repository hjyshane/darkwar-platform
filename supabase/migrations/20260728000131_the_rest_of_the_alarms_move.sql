-- 0131: the other three events that do not need the collector.
--
-- 0130 moved `sync_stalled` and explained the shape. These three follow it for
-- the same reason in a milder form: none of them describes something the
-- collector produced, so none of them has any business being unable to fire
-- when the collector is off.
--
--   player_claim       somebody asked to be linked to a player. Happens on the
--                      website. The collector is not involved and never was.
--   new_signup         somebody signed in and got no further. Same.
--   schedule_reminder  an entry on the calendar is about to start. The entry
--                      was typed by a person; the clock is the only input.
--
-- `schedule_reminder` is the one that actually hurt. A reminder is about a
-- MOMENT rather than a state — the bear hunt starts whether or not anybody's
-- desktop is on — and 0124 discards a missed one rather than sending it late,
-- deliberately, because announcing a hunt that finished on Tuesday is worse
-- than silence. On the collector's machine that policy meant "a fortnight away
-- is a fortnight of reminders nobody gets".
--
-- What stays in Python is unchanged and for the reason 0130 gave: rank periods,
-- departures, guides and notices describe things that exist because the
-- collector ran, and their rules are subtle enough that a second
-- implementation is a second thing to be wrong.

create or replace function internal.database_owned_events()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['sync_stalled', 'player_claim', 'new_signup', 'schedule_reminder']::text[]
$$;

-- Reading the routing once, the way the worker does: `app_settings` holds a
-- jsonb blob of {event: {enabled, channel}} and an absent key reads as off.
create function internal.alert_channel(p_event text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((s.value -> p_event ->> 'enabled')::boolean, false)
      then nullif(s.value -> p_event ->> 'channel', '')
  end
  from public.app_settings s
  where s.key = 'discord_notifications'
$$;

revoke execute on function internal.alert_channel(text) from public, anon, authenticated;

-- ------------------------------------------------------------- player claims
create function internal.detect_player_claims()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text := internal.alert_channel('player_claim');
  v_written int := 0;
begin
  if v_channel is null then
    return 0;
  end if;

  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  select
    v_channel,
    'player_claim',
    -- The player uid is in the key because `player_claims` is keyed by USER:
    -- somebody rejected once and claiming a different player updates the same
    -- row, and keyed on the user alone that second claim is swallowed as a
    -- duplicate of the first (0123's note, kept).
    'player_claim:' || c.user_id || ':' || coalesce(p.game_uid::text, 'null') || ':' ||
      to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US+00:00'),
    'Player link requested',
    '**' || coalesce(u.display_name, 'member ' || left(c.user_id::text, 8)) ||
      '** is asking to be linked to **' ||
      coalesce(p.current_name, 'UID ' || p.game_uid::text, 'an unnamed player') || '**.'
      || chr(10) || chr(10)
      || 'Filed: ' || to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z'
  from public.player_claims c
  left join public.players p on p.player_id = c.player_id
  left join public.app_users u on u.user_id = c.user_id
  -- No time window, unlike guides and notices. Those ask "is this news"; this
  -- asks "is this still waiting", and a fortnight-old claim is the most overdue
  -- thing on the list rather than the least. Deciding it removes it.
  where c.status = 'pending'
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke execute on function internal.detect_player_claims() from public, anon, authenticated;

-- ---------------------------------------------------------------- new signups
create function internal.detect_new_signups()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text := internal.alert_channel('new_signup');
  v_written int := 0;
begin
  if v_channel is null then
    return 0;
  end if;

  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  select
    v_channel,
    'new_signup',
    -- The uid alone, with no timestamp anywhere. `last_sign_in_at` moves every
    -- time they open the site hoping it works now; in the key that is one
    -- message per attempt from somebody already waiting.
    'new_signup:' || a.id,
    'Someone is waiting for access',
    'Somebody signed in and has no access yet (`' || left(a.id::text, 8) || '`).'
      || chr(10) || chr(10)
      -- `coalesce` around the whole phrase, not around the timestamp: in SQL a
      -- null anywhere in a concatenation makes the WHOLE string null, and a
      -- null body violates the outbox's not-null constraint. The alert would
      -- be lost to a missing sign-up date, which is not a reason to lose it.
      || coalesce('Signed up: '
           || to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z',
         'Sign-up date unknown.')
      || chr(10) || chr(10)
      || 'They need a join code before they can see anything.'
  from auth.users a
  left join public.app_users u on u.user_id = a.id
  -- The row does not exist rather than saying 'viewer': 0021 creates the
  -- app_users row inside redeem_join_code, so an account with no code is
  -- ABSENT. 0123 exists because searching for role='viewer' finds nobody,
  -- always, and looks like it worked.
  where u.user_id is null
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke execute on function internal.detect_new_signups() from public, anon, authenticated;

-- ---------------------------------------------------------- calendar reminders
create function internal.detect_schedule_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fallback text := internal.alert_channel('schedule_reminder');
  v_written int := 0;
begin
  if v_fallback is null then
    return 0;
  end if;

  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  select
    -- The board's channel wins; the settings one is only the fallback. One
    -- webhook per board is why 0124 put the channel on the category.
    coalesce(d.channel, v_fallback),
    'schedule_reminder',
    -- `starts_at` is in the key so that MOVING an entry can be said again:
    -- keyed on the reminder alone, an entry pushed back an hour would announce
    -- the old time and then stay quiet about the correction.
    'schedule_reminder:' || d.reminder_id || ':' ||
      to_char(d.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS+00:00'),
    d.title,
    case when d.category_label is not null
      then '_' || d.category_label || '_' || chr(10) || chr(10) else '' end
      || 'Starting '
      || case when d.minutes_before = 0 then 'now'
              else 'in ' || d.minutes_before || ' minutes' end
      || ' — ' || to_char(d.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z'
  from public.schedule_reminders_due d
  -- A WINDOW, not "everything overdue". Every other event here describes a
  -- state that stays true, so arriving late costs nothing. This one expires.
  -- Asked without a lower bound, the first pass after any outage announces
  -- every reminder that fell during it.
  --
  -- The window cannot be zero: this runs on a schedule, so a reminder due at
  -- 20:00 is seen at 20:00-and-a-bit and is already, strictly, late. Fifteen
  -- minutes passes ordinary lag and still drops anything older — the same
  -- REMINDER_GRACE the worker used.
  where d.fire_at <= now()
    and d.fire_at > now() - interval '15 minutes'
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke execute on function internal.detect_schedule_reminders() from public, anon, authenticated;

-- ------------------------------------------------------------------ the clock
-- Folded into the existing minute tick rather than three more jobs: they read
-- different tables, they all do nothing when their event is switched off, and
-- one schedule is one thing to look at when something stops firing.
select cron.unschedule('alerts-detect');

select cron.schedule(
  'alerts-detect',
  '* * * * *',
  $$ select internal.detect_sync_stalled(),
            internal.detect_player_claims(),
            internal.detect_new_signups(),
            internal.detect_schedule_reminders(),
            internal.deliver_owned_alerts(); $$);
