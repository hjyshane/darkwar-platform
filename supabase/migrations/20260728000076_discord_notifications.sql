-- 0076: posting to Discord — where the URL lives, and what stops a double post.
--
-- WHY THE WEBHOOK URL IS NOT IN app_settings, which is where "admin settings"
-- would normally put it.
--
-- A Discord webhook URL is a credential. Anybody holding it can post to that
-- channel as often as they like, under whatever name they choose. And 0032 grants
-- `select on app_settings` to `authenticated` on purpose — the dashboard renders
-- from it, so every member reads every key. Putting the URL there would hand the
-- whole alliance the ability to post in the alliance's own channel, and nothing
-- on screen would suggest that had happened.
--
-- So it splits in two:
--
--   notification_channels   the URL. admin only, select included.
--   app_settings            which event goes to which channel NAME. No secret,
--                           so it stays where the rest of the settings are.
--
-- The routing being world-readable is fine and mildly useful: a member can see
-- that departures are announced, without being able to announce one.
create table public.notification_channels (
  -- A name an admin picks — 'reports', 'alerts'. Referenced from app_settings by
  -- this name, never by URL, so the routing can be world-readable.
  channel text primary key,
  webhook_url text not null,
  -- Off without deleting, because deleting loses the URL and it has to be
  -- fetched from Discord again to turn it back on.
  enabled boolean not null default true,
  -- What actually happened last time, for the admin screen. A channel that has
  -- never worked and a channel nobody has used yet look identical otherwise.
  last_delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

comment on table public.notification_channels is
  'Discord webhook URLs, admin-only INCLUDING select — the URL is a credential '
  'and app_settings is readable by every member. Referenced from app_settings '
  'by channel name so the routing can stay world-readable.';

alter table public.notification_channels enable row level security;

-- No grant to anon at all, not even a revoked one: 0065 revokes select from anon
-- across the schema and sets the default, but naming it here makes the intent
-- local to the table rather than something inherited from a migration 11 numbers
-- back.
grant select, insert, update, delete on public.notification_channels to authenticated;

create policy admin_all on public.notification_channels
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- Every message we have decided to send, whether or not it went.
--
-- THE POINT IS `idempotency_key`. The deliverer polls: it asks "has this rank
-- period been announced" by looking for the key, not by remembering. So a
-- restart, a second collector, or a rebuild of the same period cannot produce a
-- second post — the same rule the whole pipeline already runs on (§11.2), applied
-- to an outward-facing side effect where a duplicate is not merely untidy but
-- visible to 94 people.
create table public.notification_outbox (
  notification_id bigint generated always as identity primary key,
  channel text not null,
  event text not null,
  idempotency_key text not null unique,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  -- Null until it actually left. Attempts and the last error stay on the row so
  -- a failure is legible without a log file.
  delivered_at timestamptz,
  attempts int not null default 0,
  last_error text
);

comment on table public.notification_outbox is
  'One row per message we decided to send. idempotency_key is what stops a '
  'restart or a period rebuild posting the same thing twice — a duplicate here '
  'is visible to the whole alliance, not just untidy.';

create index notification_outbox_pending_idx
  on public.notification_outbox (created_at)
  where delivered_at is null;

alter table public.notification_outbox enable row level security;

-- Readable by an admin, so the settings screen can show what was sent and what
-- failed. The deliverer itself runs with the service key and bypasses all of this.
grant select, insert on public.notification_outbox to authenticated;

create policy admin_read on public.notification_outbox
  for select to authenticated
  using (public.current_app_role() = 'admin');

-- ONE narrow write: an admin queueing the settings screen's "Send test".
--
-- The alternative was to let the browser POST to the webhook directly, which
-- means putting the URL in the browser — the exact thing the table split above
-- exists to prevent. So the button writes a row and the collector sends it.
--
-- `event = 'test'` is load-bearing, not decoration. Without it an admin could
-- enqueue a message with any title and body and have the bot post it into the
-- alliance channel over the collector's name, and the outbox would record it as
-- an ordinary announcement. With it, the only thing that can be inserted from a
-- browser is the fixed wiring check, and every real announcement still comes from
-- something the collector observed.
create policy admin_test_insert on public.notification_outbox
  for insert to authenticated
  with check (public.current_app_role() = 'admin' and event = 'test');

-- The routing. No URL here, so this can live with the rest of the settings.
--
-- `collector_stalled` is deliberately absent. The thing that would report a dead
-- collector is a process on the same machine, so it is dead too — an alert that
-- cannot fire in the case it exists for is worse than no alert, because it reads
-- as silence meaning healthy. That needs something outside this PC.
insert into public.app_settings (key, value) values (
  'discord_notifications',
  jsonb_build_object(
    'rank_period', jsonb_build_object('channel', 'reports', 'enabled', false),
    'departures', jsonb_build_object('channel', 'reports', 'enabled', false)
  )
)
on conflict (key) do nothing;

comment on column public.notification_channels.webhook_url is
  'Discord webhook URL. A credential: treat it like a password, and note that '
  'the service key can read this column, so rotating the webhook in Discord is '
  'the only real revocation.';
