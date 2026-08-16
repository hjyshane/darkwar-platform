-- 0124: a calendar the alliance keeps by hand, and reminders that leave it.
--
-- NOT `events`, and the name is the first decision. Spec §13's event framework
-- is deliberately unbuilt — §5.3 lists eight open protocol items and its tables
-- are absent because every field would be a guess. That work, when it happens,
-- owns the word "event": events observed in the game, captured off the wire.
--
-- This is the other thing entirely: a fortnight's schedule somebody TYPES, so
-- that 94 people know when to turn up. It needs no protocol and can be built
-- today. Sharing a table name with §13 would mean one of the two has to move
-- later, which is a migration nobody will want to write while the other is half
-- finished. `schedule_*` keeps them apart.
--
-- WHETHER THE GAME CAN FILL THIS IN IS UNANSWERED. Of the 14 commands with
-- fixtures, none carries a schedule. Three seen on the wire and never judged
-- might — `get.fortress.activity.info`, `get.alliance.duel.season.info`,
-- `hero.event.info.get` — and answering that needs a capture sweep on the
-- collector machine, not a guess here. `source` exists so the answer has
-- somewhere to land: today every row is 'manual', and a captured row can arrive
-- later without a second table or a migration to tell them apart.

-- ---------------------------------------------------------------- capabilities
insert into public.capabilities (capability, label, description, sort_order)
values
  ('schedule.view', 'See the schedule',
   'The alliance calendar. Reading only — reminders go to Discord whether or '
   'not anybody has the screen open.', 30),
  ('schedule.manage', 'Add and change schedule entries',
   'Create, edit and delete calendar entries and their reminders. An entry '
   'here becomes a Discord message at the time it says, so this is closer to '
   'announcing than to note-taking.', 31);

-- viewer written out as false rather than omitted, for 0063's reason: a missing
-- row and a false row both deny, and the admin grid should show a box to untick
-- rather than a gap.
--
-- `member` can see but not write. `officer` can write, because a calendar only
-- one person can edit is a calendar that is wrong whenever that person is
-- asleep — which is the situation this whole week of work is about.
insert into public.role_permissions (role, capability, allowed) values
  ('viewer', 'schedule.view', false),
  ('member', 'schedule.view', true),
  ('officer', 'schedule.view', true),
  ('admin', 'schedule.view', true),
  ('viewer', 'schedule.manage', false),
  ('member', 'schedule.manage', false),
  ('officer', 'schedule.manage', true),
  ('admin', 'schedule.manage', true);

-- ------------------------------------------------------------------ categories
-- One row per kind of thing on the calendar, and the channel its reminders go
-- to. The user already made a webhook per board in Discord, so the routing is
-- per CATEGORY rather than per entry: picking a webhook every time somebody adds
-- a bear hunt is how half of them end up in the wrong channel.
--
-- `channel` is a NAME, not a URL — the same split 0076 made and for the same
-- reason. The URL is a credential and lives in `notification_channels`, which is
-- admin-only including select. A name is not a secret, so this table can be read
-- by every member and the calendar can colour itself without an admin round
-- trip.
create table public.schedule_categories (
  category text primary key,
  label text not null,
  -- Rendered by the calendar. Text rather than an enum: this is decoration, and
  -- a migration to add a colour is a migration nobody should have to write.
  colour text,
  channel text references public.notification_channels (channel) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.schedule_categories is
  'Kinds of calendar entry, and which Discord channel NAME their reminders go '
  'to. Readable by every member: the name is not a credential, and the '
  'calendar needs it to colour itself. The URL stays in notification_channels.';

comment on column public.schedule_categories.channel is
  'A notification_channels name. Null means entries of this kind are on the '
  'calendar and send nothing — which is a legitimate thing to want, not a '
  'misconfiguration.';

create trigger schedule_categories_set_updated_at
  before update on public.schedule_categories
  for each row execute function public.set_updated_at();

alter table public.schedule_categories enable row level security;
revoke all on public.schedule_categories from anon;
grant select, insert, update, delete on public.schedule_categories to authenticated;

create policy member_read on public.schedule_categories
  for select to authenticated
  using (public.has_permission('schedule.view'));

create policy manager_write on public.schedule_categories
  for all to authenticated
  using (public.has_permission('schedule.manage'))
  with check (public.has_permission('schedule.manage'));

-- ---------------------------------------------------------------------- entries
create table public.schedule_events (
  schedule_event_id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  category text references public.schedule_categories (category) on delete set null,
  starts_at timestamptz not null,
  -- Null for a moment rather than a span. The calendar draws a point; a
  -- reminder does not care either way.
  ends_at timestamptz,
  -- NO RECURRENCE, and that is a decision rather than an omission. A repeating
  -- entry drags its exceptions behind it — this week moved, that week skipped,
  -- the series edited from Thursday onward — and every calendar that has tried
  -- to add them afterwards has ended up with two shapes of entry. Copying an
  -- entry covers the weekly bear hunt at a fraction of the cost. If it turns
  -- out not to, the column to add is a rule, and it goes on this table.
  --
  -- Timestamps are timestamptz UTC like everything else here. The game week
  -- resets Monday 02:00 UTC and members read the board from four time zones;
  -- storing anything local would make one of those groups wrong.
  source text not null default 'manual',
  created_by uuid references public.app_users (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_events_source check (source in ('manual', 'captured')),
  -- An entry that ends before it starts is a typo, and it draws as a negative
  -- box on the calendar rather than as an error.
  constraint schedule_events_span check (ends_at is null or ends_at >= starts_at)
);

comment on table public.schedule_events is
  'Calendar entries the alliance keeps by hand. Deliberately not named '
  '`events`: spec §13''s captured-event framework is unbuilt and owns that '
  'name. `source` is where a captured entry would land if a sweep ever '
  'confirms the game sends a schedule.';

-- The calendar asks for a window every time it draws, and a fortnight view
-- redraws on every arrow press.
create index schedule_events_starts_idx on public.schedule_events (starts_at);

create trigger schedule_events_set_updated_at
  before update on public.schedule_events
  for each row execute function public.set_updated_at();

alter table public.schedule_events enable row level security;
revoke all on public.schedule_events from anon;
grant select, insert, update, delete on public.schedule_events to authenticated;

create policy member_read on public.schedule_events
  for select to authenticated
  using (public.has_permission('schedule.view'));

create policy manager_write on public.schedule_events
  for all to authenticated
  using (public.has_permission('schedule.manage'))
  with check (public.has_permission('schedule.manage'));

-- -------------------------------------------------------------------- reminders
create table public.schedule_reminders (
  reminder_id uuid primary key default gen_random_uuid(),
  schedule_event_id uuid not null
    references public.schedule_events (schedule_event_id) on delete cascade,
  -- Relative, not absolute. Moving an entry an hour later has to move its
  -- reminders with it; stored absolutely they would fire at the old time and
  -- the mistake would only be visible as a Discord message at the wrong moment.
  minutes_before int not null,
  created_at timestamptz not null default now(),
  -- Two identical reminders on one entry is two identical messages.
  unique (schedule_event_id, minutes_before),
  constraint schedule_reminders_before check (minutes_before between 0 and 20160)
);

comment on table public.schedule_reminders is
  'When to say something about an entry, as minutes before it starts. '
  'Relative so that moving the entry moves the reminder; absolute times would '
  'keep firing at the old moment after an edit.';

alter table public.schedule_reminders enable row level security;
revoke all on public.schedule_reminders from anon;
grant select, insert, update, delete on public.schedule_reminders to authenticated;

create policy member_read on public.schedule_reminders
  for select to authenticated
  using (public.has_permission('schedule.view'));

create policy manager_write on public.schedule_reminders
  for all to authenticated
  using (public.has_permission('schedule.manage'))
  with check (public.has_permission('schedule.manage'));

-- ------------------------------------------------------------------- the notifier
-- `security_invoker = true`, unlike most views in this schema, and deliberately:
-- everything underneath is protected by RLS POLICIES rather than by a role check
-- in a WHERE clause. The service key bypasses policies, so the notifier sees
-- everything without a gate written for it — and a member reading this view gets
-- exactly what their own policies allow. Nothing here needs to reach past the
-- caller, so nothing here should be DEFINER. That is the property 0077 and 0121
-- had to argue for; this one gets it for free by not needing it.
create view public.schedule_reminders_due
with (security_invoker = true) as
select
  r.reminder_id,
  r.schedule_event_id,
  r.minutes_before,
  e.title,
  e.starts_at,
  e.category,
  c.label as category_label,
  c.channel,
  e.starts_at - make_interval(mins => r.minutes_before) as fire_at
from public.schedule_reminders r
join public.schedule_events e using (schedule_event_id)
left join public.schedule_categories c on c.category = e.category;

comment on view public.schedule_reminders_due is
  'Every reminder with the moment it should be said (fire_at) and the channel '
  'name it belongs to. Does NOT decide which are due: the notifier asks for a '
  'window, because how late is too late is a policy that belongs in one place '
  'and that place is the caller. security_invoker because the tables under it '
  'carry real RLS policies, which the service key bypasses on its own.';

grant select on public.schedule_reminders_due to authenticated;
