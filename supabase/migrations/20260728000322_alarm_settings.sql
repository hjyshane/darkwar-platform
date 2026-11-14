-- 0322: alarm settings on schedule boards, entries, reminders and the outbox.
--
-- First of six steps turning the schedule tables into Discord event alarms
-- (docs/superpowers/specs/2026-11-14-event-alarms-design.md §1, §3).
--
--   * A BOARD (schedule_categories) now says how its entries speak: a `kind`
--     (a moment, or a window that opens and closes), the steps before the start
--     and before the close, whether to speak when a window opens, an optional
--     message template, the role to ping, and — for the boards the collector
--     fills — which game activity and stage it follows.
--   * An ENTRY (schedule_events) can carry its own message and be hidden.
--   * A REMINDER (schedule_reminders) can anchor on the end of a window, and can
--     be an absolute `send_at` ("send now") instead of minutes before.
--   * The OUTBOX remembers which entry and step a message came from, whom it
--     pinged, and when it stopped being worth sending.
--
-- Steps are copied from the board onto each entry as reminder rows when the
-- entry is filed (seed_alarm_steps), so a later edit to the board changes only
-- entries filed afterwards and a manager can still switch one entry's step off.
--
-- Existing RLS (0124 + 0194) covers every new column: managers write, members
-- read. No policy is added.

-- ------------------------------------------------------------------ boards

alter table public.schedule_categories
  add column kind text not null default 'point',
  add column start_reminders int[] not null default '{720,60,5}',
  add column alarm_on_open boolean not null default true,
  add column close_reminders int[] not null default '{720,60,5}',
  add column message_template text,
  add column activity_id text,
  add column activity_stage text not null default 'main',
  add column ping_role_id text,
  add constraint schedule_categories_kind check (kind in ('point', 'window')),
  add constraint schedule_categories_stage check (activity_stage in ('main', 'signup', 'roster')),
  add constraint schedule_categories_ping_role check (ping_role_id ~ '^[0-9]{17,20}$'),
  add constraint schedule_categories_start_steps
    check (0 <= all (start_reminders) and 20160 >= all (start_reminders)),
  add constraint schedule_categories_close_steps
    check (0 <= all (close_reminders) and 20160 >= all (close_reminders));

comment on column public.schedule_categories.kind is
  'point: one moment, reminders count down to it. window: opens and closes; '
  'reminders count down to the close, and one may fire on opening.';
comment on column public.schedule_categories.activity_id is
  'The game activity a collector-filled board follows (e.g. 111001 Capital '
  'Clash, 80002 Black Gold). Null for boards kept by hand.';

-- One board per activity stage per alliance: entries generated from the
-- collector's readings find their board by (activity_id, activity_stage).
create unique index schedule_categories_activity_key
  on public.schedule_categories (alliance_id, activity_id, activity_stage)
  where activity_id is not null;

-- ----------------------------------------------------------------- entries

alter table public.schedule_events
  add column alarm_message text,
  add column hidden boolean not null default false;

comment on column public.schedule_events.alarm_message is
  'Replaces the board''s message template for this entry when set.';
comment on column public.schedule_events.hidden is
  'Kept on the board but not drawn on the calendar, and sends nothing: no '
  'alarm (0323) and no moved notice (0327).';

-- --------------------------------------------------------------- reminders

alter table public.schedule_reminders
  add column anchor text not null default 'start',
  add column send_at timestamptz,
  add column enabled boolean not null default true,
  alter column minutes_before drop default,
  alter column minutes_before drop not null,
  add constraint schedule_reminders_anchor check (anchor in ('start', 'end')),
  add constraint schedule_reminders_one_time
    check ((minutes_before is null) <> (send_at is null)),
  add constraint schedule_reminders_send_at_start check (anchor = 'start' or send_at is null);

-- 0124 left the unique constraint unnamed; Postgres called it this.
alter table public.schedule_reminders
  drop constraint schedule_reminders_schedule_event_id_minutes_before_key;
alter table public.schedule_reminders
  add constraint schedule_reminders_event_anchor_minutes_key
  unique (schedule_event_id, anchor, minutes_before);

comment on column public.schedule_reminders.anchor is
  'start: minutes before the entry starts. end: minutes before it ends (window boards).';
comment on column public.schedule_reminders.send_at is
  'An absolute moment, instead of minutes_before: how "send now" is filed.';

-- ------------------------------------------------------------------ outbox

alter table public.notification_outbox
  add column ping_role_id text,
  add column expires_at timestamptz,
  add column expired_at timestamptz,
  -- No foreign key: the history of what was said outlives the entry.
  add column schedule_event_id uuid,
  add column alarm_step text,
  add column anchor_at timestamptz;

create index notification_outbox_event_idx
  on public.notification_outbox (schedule_event_id)
  where schedule_event_id is not null;

-- ------------------------------------------------- copy a board's steps over

create function internal.seed_alarm_steps(p_event uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat public.schedule_categories;
  v_rows int := 0;
  v_n int;
begin
  select c.* into v_cat
    from public.schedule_events e
    join public.schedule_categories c
      on c.category = e.category and c.alliance_id is not distinct from e.alliance_id
   where e.schedule_event_id = p_event;
  -- An entry without a board gets nothing to say.
  if not found then
    return 0;
  end if;

  insert into public.schedule_reminders (schedule_event_id, anchor, minutes_before)
  select p_event, 'start', m from unnest(v_cat.start_reminders) as m
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;

  if v_cat.kind = 'window' then
    if v_cat.alarm_on_open then
      insert into public.schedule_reminders (schedule_event_id, anchor, minutes_before)
      values (p_event, 'start', 0)
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_rows := v_rows + v_n;
    end if;
    insert into public.schedule_reminders (schedule_event_id, anchor, minutes_before)
    select p_event, 'end', m from unnest(v_cat.close_reminders) as m
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_rows := v_rows + v_n;
  end if;
  return v_rows;
end;
$$;

revoke execute on function internal.seed_alarm_steps(uuid) from public, anon, authenticated;

-- Runs on entries the collector files (0249), so it must never raise.
create function internal.schedule_events_seed_alarm_steps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.seed_alarm_steps(new.schedule_event_id);
  return new;
exception when others then
  raise warning 'seed_alarm_steps: % (%)', sqlerrm, sqlstate;
  return new;
end;
$$;

revoke execute on function internal.schedule_events_seed_alarm_steps() from public, anon, authenticated;

create trigger schedule_events_alarm_steps
  after insert or update of category on public.schedule_events
  for each row execute function internal.schedule_events_seed_alarm_steps();

-- ---------------------------------------------------- the calendar boards

-- Boards the collector's readings land on. Capital Clash is a moment; Black
-- Gold's sign-up and roster selection are windows with no countdown to the
-- opening (start_reminders '{}'): they speak when they open (alarm_on_open's
-- default) and before they close (close_reminders' default).
create function internal.seed_calendar_boards(p_alliance uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  insert into public.schedule_categories
    (alliance_id, category, label, sort_order, kind, start_reminders, activity_id, activity_stage)
  values
    (p_alliance, 'game_capital_clash', 'Capital Clash', 100, 'point', '{720,60,5}', '111001', 'main'),
    (p_alliance, 'game_black_gold_signup', 'Black Gold sign-up', 100, 'window', '{}', '80002', 'signup'),
    (p_alliance, 'game_black_gold_roster', 'Black Gold roster selection', 100, 'window', '{}', '80002', 'roster')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function internal.seed_calendar_boards(uuid) from public, anon, authenticated;

create function internal.alliances_seed_calendar_boards()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_own and (tg_op = 'INSERT' or not old.is_own) then
    perform internal.seed_calendar_boards(new.alliance_id);
  end if;
  return new;
exception when others then
  raise warning 'seed_calendar_boards: % (%)', sqlerrm, sqlstate;
  return new;
end;
$$;

revoke execute on function internal.alliances_seed_calendar_boards() from public, anon, authenticated;

create trigger alliances_calendar_boards
  after insert or update of is_own on public.alliances
  for each row execute function internal.alliances_seed_calendar_boards();

-- ---------------------------------------------------------------- backfill

select internal.seed_calendar_boards(a.alliance_id)
  from public.alliances a
 where a.is_own;

-- Captured entries still ahead get their board's steps; past ones have
-- nothing left to say.
select internal.seed_alarm_steps(e.schedule_event_id)
  from public.schedule_events e
 where e.source = 'captured'
   and (e.starts_at > now() or e.ends_at > now());
