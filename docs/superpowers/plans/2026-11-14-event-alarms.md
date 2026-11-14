# Event Alarms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discord alarms for every alliance event: the default 12 h / 1 h / 5 m alarms from the
game calendar and from the alliance's own Siege, Frankie and Black Gold picks, officer messages
whose times follow the game, send now / send later, role pings, and an Alarms tab under Events.

**Architecture:** Everything that decides *what* to send stays in Postgres, extending the existing
minute tick (`alerts-detect`: detect → outbox → `deliver_owned_alerts` → pg_net webhook →
`reconcile_owned_alerts`). Boards (`schedule_categories`) carry alarm settings, a row in
`schedule_reminders` exists for every step, and whether a step goes out is decided at send time
from the entry's current times. The dashboard only reads and writes tables under the existing RLS,
plus one read RPC for delivery state.

**Tech Stack:** Supabase Postgres 17 (plpgsql, pg_cron, pg_net), pgTAP, React + TanStack Query +
supabase-js, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-14-event-alarms-design.md` (approved 2026-11-13). Read it
before any task; section numbers below (§1–§8) are the spec's.

## Global Constraints

- Migrations start at `20260728000322` (newest on `origin/main` on 2026-11-13 is 0321). Before
  pushing, re-read `git ls-tree --name-only origin/main supabase/migrations/ | tail -1`; if it
  moved, renumber the files, their pgTAP tests and every comment citing the number, and run
  `scripts/check-migration-order.sh`.
- pgTAP files are named after their migration: `supabase/tests/322_<topic>_test.sql`, etc.
- All times `timestamptz` UTC. The server day turns over at 02:00 UTC.
- Default steps `{720,60,5}` (minutes). Window boards default `start_reminders = '{}'`. Every step
  is between 0 and 20160 (the bound `schedule_reminders_before` already uses).
- Grace: 15 minutes at detection AND at delivery.
- Moves under 2 minutes are jitter: no moved notice, no re-send.
- Generation horizon: 14 days ahead.
- Discord limits: embed title 256, description 4096, message `content` 2000.
- Ping role ID matches `^[0-9]{17,20}$`. Payload `allowed_mentions` is `{"parse": []}` always, plus
  `"roles": [<id>]` when the board has a ping role.
- Outbox idempotency key for alarms:
  `alarm:<schedule_event_id>:<anchor>:<minutes_before or send_at epoch>:<anchor time epoch>`;
  moved notices: `alarm-moved:<schedule_event_id>:<starts epoch>:<ends epoch or 'none'>`.
- Triggers that run on captured data warn (`raise warning`), never raise.
- New `internal.*` functions: `revoke execute … from public, anon, authenticated`. New `public.*`
  RPCs: `revoke execute … from public, anon`; `grant execute … to authenticated`. Check on prod
  with `db query --linked` after the push (hosted anon grants drift).
- Every UPDATE reachable through the API carries a WHERE (`pg_safeupdate`).
- A view's body is copied from its LAST definition (`schedule_reminders_due`: 0203).
- `packages/shared-types/src/database.types.ts` is edited by hand (no Docker); follow the quirks
  in memory `hand-edited-types-generator-quirks`. CI's `db` job is the real check.
- Local gate before every push: `pnpm db:test:local` (all files),
  `pnpm check && pnpm typecheck && pnpm test && pnpm build`.
- Two PRs, in order. PR 1 = migrations + types (Tasks 1–7). After it merges, the owner runs
  `supabase db push --linked --workdir C:\darkwar-platform`. PR 2 = the dashboard (Tasks 8–10),
  merged only after the push, because merging to `main` deploys cbfw.us and the tab reads the new
  columns.
- Never edit `legacy/`. Commit messages: Conventional Commits.

## Review Focus

1. **A calendar re-read nudges a time by under 2 minutes after a step was sent** → the step must
   not go out again (the key contains the anchor time, so a naive key would re-send). Test in Task 2.
2. **A window entry with no `ends_at`** (typed by hand) → the open alarm still goes, close steps
   never fire, nothing errors. Test in Task 2.
3. **An officer message near 4,096 characters** → the message is cut with `…`; the generated time
   line always survives. Test in Task 2.
4. **An entry whose board was deleted** (`category` set null) → its existing reminder rows still
   send through the alliance fallback with the plain start line. Test in Task 2.
5. **An officer removes a calendar-made entry** → the next calendar run must not bring it back.
   Captured and calendar entries are hidden (`hidden = true`), not deleted; hidden entries send
   nothing and are never unhidden by a re-read. Tests in Tasks 4 and 5.

---

### Task 0: Branch

- [ ] **Step 1:** `git switch -c feat/event-alarms-db docs/event-alarms-design` (the spec and this
  plan travel with PR 1). Confirm `git log --oneline -2` shows the plan commit on top.

### Task 1: Alarm settings on boards, entries, reminders and the outbox

**Files:**
- Create: `supabase/migrations/20260728000322_alarm_settings.sql`
- Test: `supabase/tests/322_alarm_settings_test.sql`

**Interfaces:**
- Produces columns:
  - `schedule_categories`: `kind text not null default 'point'` check in (`point`,`window`);
    `start_reminders int[] not null default '{720,60,5}'`; `alarm_on_open boolean not null default true`;
    `close_reminders int[] not null default '{720,60,5}'`; `message_template text`;
    `activity_id text`; `activity_stage text not null default 'main'` check in
    (`main`,`signup`,`roster`); `ping_role_id text` check `~ '^[0-9]{17,20}$'`. Step arrays checked
    with `0 <= all(x) and 20160 >= all(x)`. Partial unique index on
    `(alliance_id, activity_id, activity_stage) where activity_id is not null`.
  - `schedule_events`: `alarm_message text`; `hidden boolean not null default false`.
  - `schedule_reminders`: `anchor text not null default 'start'` check in (`start`,`end`);
    `send_at timestamptz`; `enabled boolean not null default true`; `minutes_before` becomes
    nullable; check `(minutes_before is null) <> (send_at is null)`; check
    `anchor = 'start' or send_at is null`. The unique `(schedule_event_id, minutes_before)` is
    replaced by unique `(schedule_event_id, anchor, minutes_before)`.
  - `notification_outbox`: `ping_role_id text`, `expires_at timestamptz`, `expired_at timestamptz`,
    `schedule_event_id uuid` (no FK: history outlives entries), `alarm_step text`,
    `anchor_at timestamptz`; index on `(schedule_event_id) where schedule_event_id is not null`.
- Produces `internal.seed_alarm_steps(p_event uuid) returns int` and trigger
  `schedule_events_alarm_steps` (after insert, after update of `category`) calling it.

- [ ] **Step 1: Write the failing test** `322_alarm_settings_test.sql`. Fixture: one own alliance
  (`is_own = true`), a point board `t_board`, a window board `t_window` created with
  `start_reminders '{}'`, and one officer and one member `app_users` row, acting via
  `pg_temp.act_as(uuid)` + `set local role authenticated` (pattern:
  `supabase/tests/92_entered_by_hand_test.sql`). Assertions:

```sql
select is((select kind || ':' || start_reminders::text from public.schedule_categories
           where category = 't_board'), 'point:{720,60,5}', 'a new board defaults to point, 12h/1h/5m');
select is((select count(*)::int from public.schedule_categories
           where alliance_id = :own and category in
             ('game_capital_clash','game_black_gold_signup','game_black_gold_roster')), 3,
  'own alliances get the three calendar boards');
select is((select array_agg(minutes_before order by minutes_before desc) from public.schedule_reminders
           where schedule_event_id = :point_entry), '{720,60,5}'::int[], 'a point entry gets every step');
select is((select array_agg(anchor || ':' || minutes_before order by anchor desc, minutes_before desc)
           from public.schedule_reminders where schedule_event_id = :window_entry),
  '{start:0,end:720,end:60,end:5}'::text[], 'a window entry gets open + close steps');
select throws_ok($$ insert into public.schedule_reminders (schedule_event_id) values (:e) $$,
  '23514', null, 'a reminder needs minutes_before or send_at');
select throws_ok($$ insert into public.schedule_reminders (schedule_event_id, minutes_before, send_at)
  values (:e, 5, now()) $$, '23514', null, 'not both');
select throws_ok($$ update public.schedule_categories set ping_role_id = 'everyone'
  where category = 't_board' $$, '23514', null, 'a ping role is a role ID');
select lives_ok($$ update public.schedule_categories set ping_role_id = '123456789012345678'
  where category = 't_board' $$, 'an 18-digit role ID is accepted');
-- as the member:
select is_empty($$ update public.schedule_categories set ping_role_id = '123456789012345679'
  where category = 't_board' returning 1 $$, 'a member cannot change a board');
select throws_ok($$ insert into public.schedule_reminders (schedule_event_id, send_at)
  values (:e, now()) $$, '42501', null, 'a member cannot send now');
select is_empty($$ update public.schedule_events set alarm_message = 'x'
  where schedule_event_id = :e returning 1 $$, 'a member cannot write an alarm message');
```

- [ ] **Step 2:** `pnpm db:test:local` → 322 fails (missing columns).
- [ ] **Step 3: Write the migration.** Columns and constraints as in Interfaces (find the old
  unique constraint's real name with `\d public.schedule_reminders`; 0124 left it unnamed).
  `seed_alarm_steps`: read the entry's board; insert `(start, m)` for each of `start_reminders`;
  for `kind = 'window'` also `(start, 0)` when `alarm_on_open` and `(end, m)` for each of
  `close_reminders`; `on conflict do nothing`; an entry without a board gets nothing. Seed the three
  calendar boards for every `alliances.is_own` alliance (Capital Clash: point, `111001`, `main`;
  Black Gold sign-up and Black Gold roster selection: window, `start_reminders '{}'`, `80002`,
  `signup` / `roster`; `sort_order 100`; `on conflict do nothing`). Backfill: run
  `seed_alarm_steps` for captured entries whose `starts_at` or `ends_at` is still ahead.
  Existing RLS (0124 + 0194) covers the new columns; add no policy.
- [ ] **Step 4:** `pnpm db:test:local` → 322 passes and every other file still passes.
- [ ] **Step 5: Commit** `feat(db): alarm settings on schedule boards, entries and reminders`.

### Task 2: Compose and detect alarms

**Files:**
- Create: `supabase/migrations/20260728000323_alarms_compose.sql`
- Modify: `supabase/tests/77_rest_of_alarms_test.sql`, `supabase/tests/107_discord_speaks_for_one_alliance_test.sql` (keys now `alarm:%`; body text changed)
- Test: `supabase/tests/323_alarms_compose_test.sql`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `internal.alarm_render(p_text text, p_starts timestamptz, p_ends timestamptz) returns text`
    (immutable): `{start}` → `<t:S:F>`, `{in}` → `<t:S:R>`, `{end}` → `<t:E:F>` (empty when
    `p_ends` is null); S, E = whole Unix seconds.
  - `internal.alarm_line(p_kind text, p_anchor text, p_minutes int, p_send_at timestamptz,
    p_starts timestamptz, p_ends timestamptz) returns text`: point/start → `Starts <t:S:F> (<t:S:R>)`;
    window/start/0 → `Open now — closes <t:E:F> (<t:E:R>)`; window/start/>0 →
    `Opens <t:S:F> (<t:S:R>)`; end → `Closes <t:E:F> (<t:E:R>)`; one-off (`p_send_at` set): point →
    the start line; window → `Opens …` before `p_starts`, else `Closes …`. A null kind is `point`.
  - `internal.alarm_description(p_message text, p_line text) returns text`: message, blank line,
    line; total ≤ 4096 by cutting the message and appending `…`; no message → the line alone.
  - `internal.alarm_route(p_alliance uuid, p_board_channel text) returns text` (stable, definer):
    the board channel when it exists in `notification_channels` for the same alliance (0199's
    `coalesce(…, primary_own_alliance())` test), else `internal.alert_channel('schedule_reminder',
    p_alliance)`, else null.
  - View `public.schedule_reminders_due` recreated (drop + create, `security_invoker = true`,
    grants as 0124): `reminder_id, schedule_event_id, anchor, minutes_before, send_at, enabled,
    title, alarm_message, starts_at, ends_at, anchor_at, fire_at, category, category_label, channel,
    kind, message_template, ping_role_id, alliance_id, hidden`, where
    `anchor_at = case anchor when 'start' then starts_at else ends_at end` and
    `fire_at = coalesce(send_at, anchor_at - make_interval(mins => minutes_before))`.
  - `internal.detect_schedule_reminders() returns int` (same name, same cron) writes outbox rows:
    `event 'schedule_reminder'`, the Global Constraints key, `title = left(title, 256)`,
    `body = alarm_description(alarm_render(coalesce(alarm_message, message_template), …), alarm_line(…))`,
    `ping_role_id`, `expires_at = fire_at + 15 min`, `schedule_event_id`,
    `alarm_step` (`'<anchor>:<minutes>'` or `'once:<send_at epoch>'`), `anchor_at`.

- [ ] **Step 1: Write the failing test** `323_alarms_compose_test.sql`:

```sql
select is(internal.alarm_render('Rally {start} ({in}) till {end}', '2026-11-20 12:00Z', '2026-11-20 13:00Z'),
  'Rally <t:1795176000:F> (<t:1795176000:R>) till <t:1795179600:F>', 'placeholders render from the times given');
select is(internal.alarm_line('window', 'start', 0, null, '2026-11-20 12:00Z', '2026-11-20 13:00Z'),
  'Open now — closes <t:1795179600:F> (<t:1795179600:R>)', 'open line');
select is(internal.alarm_line('window', 'end', 60, null, '2026-11-20 12:00Z', '2026-11-20 13:00Z'),
  'Closes <t:1795179600:F> (<t:1795179600:R>)', 'close line');
select is(internal.alarm_line(null, 'start', 5, null, '2026-11-20 12:00Z', null),
  'Starts <t:1795176000:F> (<t:1795176000:R>)', 'no board reads as point');
select ok(right(internal.alarm_description(repeat('x', 5000), 'Starts <t:1:F> (<t:1:R>)'), 24)
  = 'Starts <t:1:F> (<t:1:R>)' and length(internal.alarm_description(repeat('x', 5000), 'Starts <t:1:F> (<t:1:R>)')) <= 4096,
  'trimming cuts the message, never the time line');                                   -- Review Focus 3
select is(internal.alarm_route(:own, 'board-ch'), 'board-ch', 'a board channel works with routing off');
select is(internal.alarm_route(:own, null), 'fallback-ch', 'no board channel: the alliance fallback');
select is(internal.alarm_route(:own, 'other-alliance-ch'), 'fallback-ch', 'never another alliance''s channel');
-- detection (entries placed relative to now(); routing on, fallback 'fallback-ch'):
select is(pg_temp.sent(:due_now, 'start:60'), 1, 'a step inside the grace is sent');
select is(pg_temp.sent(:late_20m, 'start:60'), 0, 'a step 20 minutes late is not');
select is(pg_temp.sent(:disabled, 'start:60'), 0, 'a turned-off step is not');
select is(pg_temp.sent(:hidden_entry, 'start:60'), 0, 'a hidden entry sends nothing');
select is(pg_temp.sent(:window_no_end, 'start:0'), 1, 'a window with no end still opens');       -- Review Focus 2
select is(pg_temp.sent(:window_no_end, 'end:5'), 0, 'and never closes');
select is(pg_temp.sent(:orphan, 'start:60'), 1, 'an entry whose board was deleted still sends'); -- Review Focus 4
-- re-save, jitter, move:
select is(pg_temp.resave_then_count(:due_now), 1, 'delete + re-insert of a sent step sends nothing new');
select is(pg_temp.nudge_then_count(:due_now, interval '1 minute'), 1, 'a 1-minute nudge does not re-send'); -- Review Focus 1
select is(pg_temp.nudge_then_count(:due_now, interval '3 hours'), 2, 'a 3-hour move sends again at the new time');
select is(pg_temp.sent(:once_now, 'once'), 1, 'send now goes out once');
select ok((select body from public.notification_outbox where schedule_event_id = :due_now limit 1)
  like 'Bring shields%Starts <t:%', 'officer message first, generated line last');
```

  `pg_temp.sent(entry uuid, step text)` runs `internal.detect_schedule_reminders()` and counts outbox
  rows for that entry whose `alarm_step` starts with `step`; the other two helpers do what their
  names say, then detect, then count.
- [ ] **Step 2:** `pnpm db:test:local` → 323 fails.
- [ ] **Step 3: Write the migration.** Detection selects due rows where `enabled`, `not hidden`,
  `anchor_at is not null`, `fire_at <= now()`, `fire_at > now() - interval '15 minutes'`,
  `alarm_route(…) is not null`, and NO outbox row exists with the same `schedule_event_id` and
  `alarm_step` whose `anchor_at` is within 2 minutes of this one; then `on conflict
  (idempotency_key) do nothing`. Revoke as Global Constraints. Update tests 77 and 107 to the new
  key prefix and body; keep what they prove (routing off → nothing; one alliance's reminder never in
  the other's channel).
- [ ] **Step 4:** `pnpm db:test:local` → all pass.
- [ ] **Step 5: Commit** `feat(db): compose alarm messages and send each step once`.

### Task 3: Deliver with pings, expire stale alarms, read delivery state

**Files:**
- Create: `supabase/migrations/20260728000324_alarms_deliver.sql`
- Test: `supabase/tests/324_alarms_deliver_test.sql`

**Interfaces:**
- Consumes: outbox columns from Task 1; rows from Task 2.
- Produces:
  - `internal.alert_payload(p_title text, p_body text, p_ping_role_id text) returns jsonb`
    (immutable): `{"embeds":[{"title","description"}], "allowed_mentions":{"parse":[]}}`; with a role
    also `"content": left('<@&' || id || '> ' || title, 2000)` and `"allowed_mentions":
    {"parse":[], "roles":[id]}`.
  - `internal.expire_stale_alerts() returns int`: rows with `delivered_at`, `transport_request_id`,
    `expired_at` null and `expires_at <= now()` get `expired_at = now()`,
    `last_error = 'expired: not sent within 15 minutes of its time'`.
  - `internal.next_alerts(p_limit int) returns table (notification_id bigint, url text, payload jsonb)`:
    undelivered, no transport in flight, `attempts < 5`, not expired, `expires_at` null or in the
    future, event in `internal.database_owned_events()`, channel enabled with a webhook — oldest first.
  - `internal.deliver_owned_alerts(p_limit int default 10) returns int` (same signature, same
    cron): `expire_stale_alerts()`, then post each `next_alerts` row with `extensions.net.http_post`,
    same transport/attempt bookkeeping as 0130.
  - `public.alarm_deliveries(p_events uuid[]) returns table (schedule_event_id uuid, alarm_step text,
    anchor_at timestamptz, delivered_at timestamptz, expired_at timestamptz)` (stable, definer):
    only entries the caller may see — `has_permission('schedule.view')` and the entry's alliance is
    `active_alliance()` (0194's predicate); otherwise no rows.

- [ ] **Step 1: Write the failing test** `324_alarms_deliver_test.sql`:

```sql
select is(internal.alert_payload('BG · A', 'x', '123456789012345678') -> 'allowed_mentions',
  '{"parse": [], "roles": ["123456789012345678"]}'::jsonb, 'only the board role can be pinged');
select is(internal.alert_payload('BG · A', 'x', '123456789012345678') ->> 'content',
  '<@&123456789012345678> BG · A', 'the ping names the event');
select ok(not (internal.alert_payload('BG · A', 'x', null) ? 'content'), 'no role: no content, no ping');
select is(internal.alert_payload('t', '@everyone come', null) -> 'allowed_mentions',
  '{"parse": []}'::jsonb, '@everyone in a message notifies nobody');
select is(internal.expire_stale_alerts(), 1, 'one alarm 20 minutes past its time expires');
select is((select expired_at is null from public.notification_outbox where idempotency_key = 'fresh'),
  true, 'a fresh alarm does not');
select is((select expired_at is null from public.notification_outbox where idempotency_key = 'sync-stalled'),
  true, 'an alert with no expiry never expires');
select is((select array_agg(notification_id) from internal.next_alerts(10)), array[:sendable_id],
  'ten older rows on a disabled channel do not starve a sendable one');
-- RPC, as a member of the own alliance / of another alliance / anon:
select is((select count(*)::int from public.alarm_deliveries(array[:e])), 1, 'members read delivery state');
select is((select count(*)::int from public.alarm_deliveries(array[:e])), 0, 'another alliance reads nothing');
select throws_ok($$ select * from public.alarm_deliveries(array[:e]) $$, '42501', null, 'anon cannot call it');
```

- [ ] **Step 2:** `pnpm db:test:local` → 324 fails.
- [ ] **Step 3: Write the migration** (functions as in Interfaces; grants per Global Constraints).
- [ ] **Step 4:** `pnpm db:test:local` → all pass.
- [ ] **Step 5: Commit** `feat(db): ping a role, expire stale alarms, never block other alerts`.

### Task 4: Entries from the game calendar

**Files:**
- Create: `supabase/migrations/20260728000325_alarms_from_the_calendar.sql`
- Test: `supabase/tests/325_alarms_from_the_calendar_test.sql`

**Interfaces:**
- Consumes: boards with `activity_id`/`activity_stage` (Task 1); `public.event_schedule_current`
  (0210); `public.epoch_ms_to_timestamptz(jsonb)` (0208).
- Produces: `internal.sync_calendar_alarms(p_now timestamptz default now()) returns int`, and cron
  job `alarms-calendar` every 5 minutes (`*/5 * * * *`).

Times per stage (from the calendar row `c` and `d = c.detail`):

| Stage | `starts_at` | `ends_at` |
|---|---|---|
| `main` | `c.starts_at` | `coalesce(d.battleEndTime, c.ends_at)` |
| `signup` | `d.startSignUpTime` | `d.stopSignUpTime` |
| `roster` | `d.stopSignUpTime` | `d.battleOpenTime` |

`source_key = 'cal:' || activity_id || ':' || stage || ':' || <c.starts_at epoch>`; `source = 'captured'`;
title = the board's label. Generated only when the board's alliance `is_own`, its `server_id` is the
row's `server_id`, both times are known, the relevant time (start for point boards, end for window
boards) is after `p_now`, and `starts_at <= p_now + 14 days`. On conflict update `starts_at`,
`ends_at`, `updated_at` only when a time differs — never title, message, board or `hidden`.
Absence from a snapshot deletes nothing.

- [ ] **Step 1: Write the failing test** `325_alarms_from_the_calendar_test.sql`. Fixture: an
  `event_schedule_snapshots` row for server 580 with activities `111001` and `80002` (detail with
  `startSignUpTime`, `stopSignUpTime`, `battleOpenTime` as epoch ms), two own alliances on 580 and
  one not-own:

```sql
select is(internal.sync_calendar_alarms(), 6, 'three boards × two own alliances');
select is(pg_temp.times('game_black_gold_signup'), :signup_start || '→' || :signup_stop, 'sign-up window');
select is(pg_temp.times('game_black_gold_roster'), :signup_stop || '→' || :battle_open, 'roster window');
select is(internal.sync_calendar_alarms(), 0, 're-reading writes nothing');
select is(pg_temp.after_newer_snapshot_moving_stop_signup(), 'moved', 'a newer reading moves the entry in place');
select is((select alarm_message from public.schedule_events where schedule_event_id = :signup_entry),
  'keep me', 'and keeps the officer''s message');
select is(pg_temp.count_after_snapshot_without_80002(), 6, 'missing from a reading deletes nothing');
select is(pg_temp.count_far_future(), 0, 'nothing more than 14 days ahead');
select is(pg_temp.hidden_after_resync(:signup_entry), true, 'a hidden entry stays hidden');   -- Review Focus 5
select is((select count(*)::int from public.schedule_events where alliance_id = :not_own), 0,
  'other alliances get nothing');
```

- [ ] **Step 2:** `pnpm db:test:local` → 325 fails.
- [ ] **Step 3: Write the migration** (function + `cron.schedule('alarms-calendar', '*/5 * * * *', …)`).
- [ ] **Step 4:** `pnpm db:test:local` → all pass.
- [ ] **Step 5: Commit** `feat(db): alarm entries from the game calendar`.

### Task 5: A moved pick is a move

**Files:**
- Create: `supabase/migrations/20260728000326_event_times_move_not_replace.sql`
- Modify: `supabase/tests/250_alliance_event_times_test.sql` (body is null now; a day move keeps the id)
- Test: `supabase/tests/326_event_times_move_test.sql`

**Interfaces:**
- Consumes: 0249's `internal.apply_alliance_event_time()` (its only definition; copy it whole).
- Produces: the same trigger function, changed in two places only:
  1. The insert writes `body = null` instead of `'Read from the game.'`.
  2. The `delete` of other-day future entries becomes a move: when no entry with `v_key` exists,
     the soonest future captured entry with the same `event_key:slot:` prefix gets
     `source_key = v_key`, the new `starts_at`/`ends_at`, `updated_at = now()`; any further ones are
     deleted as before. The insert-on-conflict that follows then finds it.

  This implements spec §2's "a pick that moves to another server day is a move" by moving the
  entry in place rather than re-keying by activity window: the trigger already treats every future
  entry with the same event and slot as the one being replaced, so keeping that row keeps its id,
  message, reminders and history, and existing keys need no data migration. Data: set
  `body = null` where `source = 'captured' and body = 'Read from the game.'`.

- [ ] **Step 1: Write the failing test** `326_event_times_move_test.sql` (fixture as in test 250):

```sql
select is(pg_temp.entry_id_after_pick_moves_a_day(), :original_id, 'a pick moved to the next day keeps its entry');
select is((select alarm_message from public.schedule_events where schedule_event_id = :original_id),
  'Bring shields', 'and its message');
select is((select count(*)::int from public.schedule_reminders
           where schedule_event_id = :original_id and not enabled), 1, 'and its turned-off step');
select is((select starts_at from public.schedule_events where schedule_event_id = :original_id),
  :new_start, 'at the new time');
select is((select body from public.schedule_events where schedule_event_id = :fresh_id), null,
  'captured entries carry no "Read from the game."');
select is(pg_temp.hidden_after_move(:hidden_id), true, 'a hidden pick stays hidden when it moves'); -- Review Focus 5
```

- [ ] **Step 2:** `pnpm db:test:local` → 326 fails.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4:** `pnpm db:test:local` → all pass (including the edited 250).
- [ ] **Step 5: Commit** `fix(db): a Siege/Frankie/Black Gold pick that changes day moves its entry`.

### Task 6: Announce a moved time

**Files:**
- Create: `supabase/migrations/20260728000327_alarm_moved_notice.sql`
- Test: `supabase/tests/327_alarm_moved_notice_test.sql`

**Interfaces:**
- Consumes: `alarm_route` (Task 2), outbox columns (Task 1).
- Produces: `internal.announce_alarm_move() returns trigger`, trigger `schedule_events_moved` after
  update of `starts_at, ends_at` on `schedule_events`. It writes one outbox row when the entry is not
  hidden, `starts_at` or `ends_at` moved by 2 minutes or more, and an outbox row with this
  `schedule_event_id`, key `like 'alarm:%'` and `delivered_at is not null` exists. Row: event
  `'schedule_reminder'`, key per Global Constraints, title `left(title, 256)`, body
  `**<title> moved** — now <t:S:F> (<t:S:R>)` (window boards: `— now <t:S:F> to <t:E:F>`),
  `ping_role_id` from the board, `expires_at = now() + 15 min`, channel from `alarm_route`.
  Any error → `raise warning`, return.

- [ ] **Step 1: Write the failing test** `327_alarm_moved_notice_test.sql`:

```sql
select is(pg_temp.notices_after_move(:sent_entry, interval '3 hours'), 1, 'a move after an alarm went out is announced');
select ok((select body from public.notification_outbox where idempotency_key like 'alarm-moved:%' limit 1)
  like '**Zombie Siege moved** — now <t:%:F> (<t:%:R>)', 'in the agreed words');
select is(pg_temp.notices_after_move(:sent_entry, interval '0'), 1, 'the same move twice is one notice');
select is(pg_temp.notices_after_move(:sent_entry2, interval '90 seconds'), 0, 'jitter is not announced');
select is(pg_temp.notices_after_move(:unsent_entry, interval '3 hours'), 0, 'nothing sent yet: nothing to correct');
select is((select ping_role_id from public.notification_outbox where idempotency_key like 'alarm-moved:%' limit 1),
  '123456789012345678', 'the notice pings like the alarms');
```

- [ ] **Step 2:** `pnpm db:test:local` → 327 fails.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4:** `pnpm db:test:local` → all pass.
- [ ] **Step 5: Commit** `feat(db): announce when an alarmed event moves`.

### Task 7: Types, gate, PR 1

**Files:**
- Modify: `packages/shared-types/src/database.types.ts`

- [ ] **Step 1:** Hand-edit the types: new columns on `schedule_categories`, `schedule_events`,
  `schedule_reminders` (`minutes_before: number | null`), `notification_outbox`; the recreated
  `schedule_reminders_due` view's Row; `alarm_deliveries` under Functions (alphabetical). Internal
  functions are not in the file.
- [ ] **Step 2:** Full gate (Global Constraints) → green. Re-check the migration number against
  `origin/main`; run `scripts/check-migration-order.sh`.
- [ ] **Step 3: Commit** `chore(types): alarm columns and alarm_deliveries`; push; open PR 1
  ("Event alarms: database"). Body: the spec link, what the owner must do after merge (the
  `db push` command), and that PR 2 waits for it. Read the `db` CI job before asking to merge.
- [ ] **Step 4:** After the owner's push, check on prod: `select has_function_privilege('anon',
  'public.alarm_deliveries(uuid[])', 'execute')` is false; the three boards exist per own alliance;
  `cron.job` lists `alarms-calendar`.

### Task 8: Alarms data layer (dashboard)

Branch `feat/event-alarms-tab` from `origin/main` after PR 1 merges.

**Files:**
- Create: `apps/dashboard/src/features/alarms/alarmLogic.ts`, `alarmLogic.test.ts`, `alarms.ts`

**Interfaces:**
- Produces (`alarmLogic.ts`, pure):
  - `type AlarmStep = { reminderId: string | null; anchor: 'start' | 'end'; minutesBefore: number | null; sendAt: string | null; enabled: boolean }`
  - `type Delivery = { alarmStep: string; anchorAt: string; deliveredAt: string | null; expiredAt: string | null }`
  - `type ChipState = 'sent' | 'pending' | 'off' | 'skipped'`
  - `stepKey(step: AlarmStep): string` → `'start:60'`, `'end:5'`, `'once:<epoch>'` (matches the DB's `alarm_step`).
  - `chipFor(step: AlarmStep, entry: { startsAt: string; endsAt: string | null }, deliveries: Delivery[], now: Date): { label: string; state: ChipState }`
    — off if not enabled; sent if a delivery with the same key has `deliveredAt` and an `anchorAt`
    within 2 minutes of the step's current anchor; skipped if the fire time is more than 15 minutes
    past; else pending. Labels: `12h`, `1h`, `5m`, `open`, `close 1h`, a one-off's local time.
  - `reminderDiff(current: AlarmStep[], desired: AlarmStep[]): { update: AlarmStep[]; insert: AlarmStep[]; remove: string[] }`
    — matched by `stepKey`; never removes a row whose step is still desired.
  - `previewMessage(text: string, startsAt: string, endsAt: string | null, zone: string): string` —
    `{start}`, `{in}`, `{end}` rendered as the reader would see them.
- Produces (`alarms.ts`, TanStack Query over supabase-js): `useAlarmEntries()` (the reader's
  alliance, `starts_at` or `ends_at` ahead, `starts_at` within 14 days, `hidden = false`, with
  reminders), `useAlarmBoards()`, `useAlarmDeliveries(eventIds: string[])` (RPC
  `alarm_deliveries`), `useGameEventsForServer(serverId: number)` (`event_schedule_current`),
  mutations `useSaveEntryAlarms()` (message + `reminderDiff`), `useSendOnce()` (`send_at` = now or
  chosen), `useHideEntry()` (captured → `hidden = true`; manual → delete), `useSaveBoard()`,
  `useWatchGameEvent()` (window board with `activity_id`, `start_reminders: []`),
  `useUnplacedPicks()` (`alliance_event_times` rows with `alliance_id is null` captured in the last
  14 days — the picks 0249 could not put on any board; members can read that table).

- [ ] **Step 1: Write the failing tests** in `alarmLogic.test.ts`:

```ts
test('a sent step stays sent when the time moved by under 2 minutes', () => {
  expect(chipFor(step60, entryMovedBy(90_000), [delivered('start:60', START)], NOW).state).toBe('sent');
});
test('a step whose time moved by hours is pending again', () => {
  expect(chipFor(step60, entryMovedBy(3 * HOUR), [delivered('start:60', START)], NOW).state).toBe('pending');
});
test('a past, unsent step reads as skipped; a turned-off one as off', () => {
  expect(chipFor(step720, entryIn(30 * MIN), [], NOW)).toEqual({ label: '12h', state: 'skipped' });
  expect(chipFor({ ...step60, enabled: false }, entryIn(DAY), [], NOW).state).toBe('off');
});
test('reminderDiff keeps unchanged rows and removes only dropped steps', () => {
  expect(reminderDiff([s720, s60, s5], [s720, { ...s60, enabled: false }])).toEqual(
    { update: [{ ...s60, enabled: false }], insert: [], remove: [s5.reminderId] });
});
test('previewMessage renders placeholders in the reader zone', () => {
  expect(previewMessage('At {start}', '2026-11-20T12:00:00Z', null, 'Asia/Seoul')).toContain('21:00');
});
```

- [ ] **Step 2:** `pnpm --filter dashboard vitest run alarmLogic` → fails.
- [ ] **Step 3:** Implement `alarmLogic.ts`, then `alarms.ts` (reuse `toLocal` from
  `features/schedule/schedule.ts` by moving it into `alarmLogic.ts` if Task 9 deletes that file).
- [ ] **Step 4:** Tests pass; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(dashboard): alarm chips, reminder diff and alarm queries`.

### Task 9: The Alarms tab

**Files:**
- Create: `apps/dashboard/src/features/alarms/AlarmsPage.tsx` (upcoming list), `AlarmEntryPanel.tsx`
  (message, chips, send now / later, back to board defaults, hide), `AlarmBoardsPanel.tsx` (kind,
  channel, ping role with "use for every board", steps, template, watch a game event, warnings),
  `AlarmsPage.test.tsx`
- Modify: `apps/dashboard/src/lib/route.ts` (Route `'alarms'`; `'#/alarms'` and `'#/schedule'` → `'alarms'`;
  `EVENTS_HUB_TABS` gains `{ route: 'alarms', hash: '#/alarms', label: 'Alarms' }` after
  Participation; drop Route `'schedule'` and its switch cases), `lib/shellNav.ts` (ICONS
  `alarms: 'calendar'`), `App.tsx` (`case 'alarms'` → `<AlarmsPage />`; remove the `schedule` branch),
  route/shellNav tests that enumerate hub tabs or hashes
- Delete: `features/schedule/SchedulePanel.tsx`, `ScheduleEditor.tsx`, `ScheduleBoards.tsx`,
  `schedule.ts` and their tests, once nothing else imports them (grep first)

**Interfaces:**
- Consumes: everything Task 8 produces; `isAllowed(permissions?.grants, session?.role, 'schedule.manage')`
  (as `SchedulePanel.tsx:98` does) to show edit controls.

Behaviour fixed by the spec (§8): each row shows title, board, time in the reader's zone with
server time (UTC−2) beside it, source (game / alliance pick / manual) and one chip per step.
The message box shows the placeholders and a `previewMessage` line, and its `maxLength` leaves room
for the time line (3,900). The ping-role field accepts only `^[0-9]{17,20}$` and says where to copy
it from (Developer Mode → right-click the role → Copy Role ID). A board with no channel while the
alliance's reminder routing is off shows "Nothing will be sent", and `useUnplacedPicks()` rows show
as "Picks the game reported that could not be tied to an alliance". Members see the same page
read-only.

- [ ] **Step 1: Write the failing tests:** `route.test.ts` — `'#/alarms'` and `'#/schedule'` both
  parse to `'alarms'` and `inEventsHub('alarms')`; `AlarmsPage.test.tsx` — with mocked hooks, a
  member sees chips `12h ✓ sent`, `1h · pending` and no Send button; an officer sees Send now.
- [ ] **Step 2:** `pnpm test` → the new tests fail.
- [ ] **Step 3:** Implement the three components (each under 400 lines) and the wiring; delete the
  old screen.
- [ ] **Step 4:** Full gate (`pnpm check && pnpm typecheck && pnpm test && pnpm build`); run the app
  (`run-dashboard` skill) against the local stack and click through: a member, then an officer
  sending a one-off. Screenshot both.
- [ ] **Step 5: Commit** `feat(dashboard): Alarms tab under Events`.

### Task 10: Ship and watch one real event

- [ ] **Step 1:** Push, open PR 2 ("Event alarms: the tab"). Confirm with the owner that the
  migration is on prod before merging (merging deploys cbfw.us).
- [ ] **Step 2:** Update `docs/handover.md` (alarms live; first real event not yet watched) and
  append to `docs/log/2026-11.md`; commit `docs: event alarms shipped`.
- [ ] **Step 3 (owner):** In Discord, create a test role held by one member and a test channel;
  set them on the Zombie Siege board. Watch the next Siege or Frankie: the 12 h / 1 h / 5 m alarms
  arrive, the phone gets a push for the role, and the times read right in two time zones. If the
  ping renders but no push arrives, turn on "Allow anyone to @mention this role" for that role
  (spec §4) and retry with send now.
