# Event alarms to Discord — design

Status: draft for the owner's approval, 2026-11-14. Revised the same day after
a builder's read-through (it corrected five claims about the existing code;
those are fixed below).
Asked for on 2026-11-12; brainstormed in `plan/website-restructure-2026-11.md` §9.

## Why

Alliance events only work when members turn up at the right minute: Frankie,
Black Gold, the Zombie Siege, Capital Clash, territory captures, season
events. Today an officer has to notice the time in the game and remind people
by hand, in four time zones. The owner wants the Discord bot to do it: announce
an event as soon as its time is known, then remind the alliance **12 hours, 1
hour and 5 minutes** before it starts, without anybody typing anything.
Officers can add their own message to any event, or send one now or later.

Success: on an ordinary week nobody types an event time or a reminder, the
reminders go out on time in each alliance's own channel, and when the game
moves a time the reminders follow it.

## What already exists (read this before planning)

Most of the machinery is built; this design mostly connects it. Migration
numbers are the last four digits of `supabase/migrations/20260728000NNN_*.sql`.

| Piece | Where | What it does today |
|---|---|---|
| Calendar entries | `schedule_events` (0124, alliance-scoped 0194/0203) | `title`, `body`, `category`, `starts_at`, `ends_at`, `source` ('manual' or 'captured'), `source_key` (0249), `alliance_id`. No recurrence, on purpose. |
| Boards | `schedule_categories` (0124/0203) | One per kind of entry, unique per `(alliance_id, category)`, carrying the Discord `channel` NAME its reminders go to. |
| Reminders | `schedule_reminders` (0124) | `(schedule_event_id, minutes_before)`, unique, 0–20160. |
| Due view | `schedule_reminders_due` (last defined in 0203) | Joins reminder → entry → board; `fire_at = starts_at - minutes_before`. |
| Detector | `internal.detect_schedule_reminders()` (last defined in 0199:505), pg_cron every minute (0131) | Inserts into `notification_outbox` for reminders whose `fire_at` is in the last 15 minutes. Key = `schedule_reminder:<reminder_id>:<starts_at>`. Text: "Starting in N minutes — YYYY-MM-DD HH:MMZ". Channel = the board's channel if it belongs to the entry's alliance, else the fallback `internal.alert_channel('schedule_reminder', alliance)`. **Today nothing is sent at all when that fallback is null, even if the board has a channel (0199:540-544).** |
| Delivery | `internal.deliver_owned_alerts` (0130:120-170), pg_cron | Takes 10 undelivered rows, oldest first; POSTs `{embeds:[{title, description}]}` to the channel's webhook via pg_net; the Discord message id is not kept. **No age check at delivery**, and a row whose channel is disabled is skipped without using an attempt — so it is sent late once the channel is enabled, and ten such rows block every database-owned alert behind them. Text is not trimmed; Discord answers an oversized embed with a 400. |
| Times the alliance picks | `alliance_event_times` + `internal.apply_alliance_event_time()` (0249) | Siege, Frankie slots 1–2, Black Gold teams A/B land on the boards `game_zombie_siege`, `game_bio_mutant`, `game_black_gold` as `captured` entries, keyed by event, slot and SERVER DAY. Writes `body = 'Read from the game.'` and an `ends_at` on every row. When a pick moves to another day it DELETES the old entry and inserts a new one (0249:177-194). Skips rows starting more than 14 days in the past; no limit ahead. Adds no reminder; its boards start with no channel. The alliance is known only through the collector account that was logged in, so **an alliance with no collector account gets no picks** (0249:104-113; the runbook says ACE needs its own account). |
| Times the game sets | `event_schedule_snapshots` (0208) → `event_schedule_current` (0210) | The server's calendar from the login response, per server: `activity_id`, `name` (from `event_names`), `starts_at`, `ends_at`, `detail` jsonb with the per-event extras. Accounts see slightly different lists (0208's header), so an activity missing from one snapshot is not proof it ended. |
| Old screen | `features/schedule/*` at `#/schedule` | Archived 2026-10-03 (no tab, address still opens). Has reminder chips and board/channel pickers, **but saves reminders by deleting all and re-inserting (`schedule.ts:205-224`)** — new ids every save. |

`schedule.manage` belongs to the site roles officer and admin (0124:40-48). Being
R4/R5 in the game does not grant it (0045); mapping in-game rank to the site
role is separate work in the restructure plan.

Server time is UTC−2 and the game's day turns over at 02:00 UTC. All storage is
`timestamptz` UTC.

## Goals

1. **Every alliance event the game tells us about becomes a calendar entry
   with default alarms, automatically.** Default: 12 h, 1 h and 5 min before
   the start. No officer action needed for the ordinary week.
2. **Events that are windows** (Black Gold sign-up, season events lasting days)
   alarm **when they open and before they close** (owner, 2026-11-12), not
   before they start.
3. **Only the steps still ahead go out.** An event first seen 3 hours before
   its start gets the 1 h and 5 min alarms, not a late "12 hours" one.
4. **When the game moves a time, everything follows it**: pending alarms fire
   at the new time, and every alarm's text shows the new time — including an
   officer's own message (owner, 2026-11-13).
5. **Officers can, for any event:** write a message that rides on its alarms,
   change which alarms it gets, send a message now, or schedule one for a
   chosen time.
6. **An "Alarms" sub-tab under the alliance's Events hub**: the upcoming events
   with their times and the state of each alarm.
7. **Each alliance separately**: its own events, its own channels.

## Non-goals

- Discord DMs to individual members.
- Editing a Discord message after it was posted (see section 6).
- Alarms for territory captures (declarations): they arrive when the
  declare-war reader is built (territory design). The board model must accept
  them later without change.
- Server Clash until its new round shows up in the game calendar; a manual
  entry covers it meanwhile.
- Public pages. The site is members only (owner, 2026-11-13).
- Announcing cancellations (section 3).

## Anti-goals (would make it a failure even if it "works")

- A reminder in the wrong alliance's channel.
- A burst of stale reminders after an outage ("starts in 12 hours" for
  something that started yesterday).
- Two messages for one alarm, including after an officer edits the entry.
- Times shown in one time zone. Members are in four.
- An officer's custom text silently overwritten or deleted by a game update.

## The design

### 1. Boards carry the alarm settings

A board (`schedule_categories` row) already means "a kind of event, and the
channel it announces in". It gains:

- `kind text` — `'point'` (one moment: a battle, Frankie, the Siege) or
  `'window'` (open for a span: sign-up, a season event). The kind decides the
  alarms, not whether the entry has an `ends_at` — 0249 stores `ends_at` on
  every row.
- `start_reminders int[]` — minutes before START. Default `{720, 60, 5}` for
  point boards, `{}` for window boards.
- `alarm_on_open boolean` — window boards: one alarm when it opens. Default true.
- `close_reminders int[]` — window boards: minutes before END. Default
  `{720, 60, 5}` (my call: the same steps as a start).
- `message_template text` (nullable) — the default message for this kind.
- `activity_id text` (nullable) — when set, entries are generated from the game
  calendar for this activity (section 3).
- `ping_role_id text` (nullable) — the Discord role this board's alarms ping
  (section 4). A role ID: 17–20 digits, checked by a constraint.

Reminders (`schedule_reminders`) gain:

- `anchor text not null default 'start'`, check in (`'start'`, `'end'`);
  `fire_at` = anchor time − `minutes_before`. "Open" is `anchor='start'`,
  `minutes_before=0` on a window entry.
- `send_at timestamptz` for one-off sends (section 5); exactly one of
  (`minutes_before`, `send_at`) is set.
- `enabled boolean not null default true` — an officer unticking an alarm sets
  it false; the row stays.

**A row exists for every default step, always.** Creating an entry on a board
inserts one row per step from the board's settings, past or not. Whether a
step goes out is decided at send time from the CURRENT times (fire_at inside
the grace window, enabled, not yet sent). So if the game moves an event later,
a step that was "too late" comes back by itself (my call). The tab can tell
"skipped — too late" (fire_at passed, never sent, enabled) from "turned off"
(enabled = false).

Applies to captured entries (0249's trigger and section 3) and to manual ones
(the editor pre-ticks the board's steps).

**Idempotency must not depend on the row id.** The outbox key becomes
`alarm:<schedule_event_id>:<anchor>:<minutes_before or send_at>:<anchor time>`.
A re-saved reminder with a new id cannot send twice, and a moved time still
re-fires at the new time. The Alarms tab saves reminders as a diff (update the
changed rows, insert new ones, delete only the ones removed), never delete-all.

**Channel routing (fixes today's on/off switch):** the board's channel is used
if it belongs to the entry's alliance (0199's check stays); the alliance's
`schedule_reminder` fallback is used only when the board has none; nothing is
sent only when both are missing, and the tab says so on that board. Seeded
boards start with no channel, so everything goes to the alliance's
`schedule_reminder` channel until an officer picks per-board channels in the
tab.

### 2. Black Gold, Frankie and the Siege: the alliance's own times

0249 lands these. Changes:

- Their boards get settings (section 1): `game_zombie_siege` and
  `game_bio_mutant` are point boards; Black Gold splits (below).
- **Frankie and the Siege show the time the alliance picked**, not the game's
  two-day window (owner). The calendar windows for these two activities are
  not turned into entries.
- **A pick that moves to another server day is a move, not a new event** (my
  call). 0249 currently deletes the old entry and inserts a new one, which
  would throw away the officer's message, unticked alarms and the sent history.
  The key changes from "event, slot, server day" to "event, slot, the game's
  activity window" (the calendar `startTime` of the Siege/Frankie/Black Gold
  activity the pick belongs to), and a moved pick updates the existing entry.
  When the window cannot be told, fall back to today's server-day key.
- **Captured entries no longer write `body = 'Read from the game.'`** into
  anything that reaches Discord. The officer's alarm message lives in its own
  column (section 4), so `body` stays free for the calendar's own notes.
- **Black Gold is shown in stages** (owner, 2026-11-12):

  | Stage | Board kind | From | To | Source |
  |---|---|---|---|---|
  | Sign-up | window | `startSignUpTime` | `stopSignUpTime` | calendar activity 80002 `detail` |
  | Roster selection | window | `stopSignUpTime` | `battleOpenTime` | same; *the name is my reading — the data only shows the gap* |
  | Team B battle, Team A battle | point | the alliance's picks | +45 min | 0249 (`dragon.activity.info`) |

  Observed rhythm (UTC): every two weeks; week starts Mon 02:00; sign-up
  Wed 02:00 → Fri 02:00; the gap Fri 02:00 → Sun 02:00; battle day Sun 02:00 →
  Mon 02:00 (Sunday on the server clock, Saturday 21:00 US Eastern). CBFW's
  last three: B 12:05Z, A 21:05Z.

- **Alliances without a collector account** (ACE today) get the calendar-driven
  entries of their server (section 3) and manual ones, but no Siege, Frankie or
  Black Gold team picks until an ACE account is logged in on a collector.

### 3. Events the game schedules: from the calendar

A job turns `event_schedule_current` rows into `captured` entries for every
board with an `activity_id`, for each own alliance on that server
(`alliances.server_id`). Keyed by activity, stage and the activity's own
`startTime`, so a re-read updates instead of duplicating; it updates WHEN only,
never an officer's title, message or board.

**New rule:** only entries that start (or close, for windows) in the future and
within 14 days ahead are generated.

**Nothing is deleted because it is missing from a snapshot** (my call):
accounts see slightly different calendars, so absence is noise. An entry
changes only when a newer reading gives it a different time; an officer can
delete it. Cancellations are not announced.

Seeded boards per own alliance:

| Board | Kind | Activity | Entry |
|---|---|---|---|
| Capital Clash | point | 111001 | `starts_at` → `detail.battleEndTime` (14:00–17:00Z, Saturdays, every 2 weeks) |
| Black Gold sign-up | window | 80002 | section 2 |
| Black Gold roster | window | 80002 | section 2 |

Season events change every season, so they are not hard-coded: the Alarms tab
offers "watch a game event", listing what is in `event_schedule_current` for
the alliance's server by name, and creates a window board with that
`activity_id`. Season 4 candidates: Maple Isle Clash 40748, Azure Catastrophe
55519, Oni King Descends 55520, Wrath of King Scorpion, Miasma Bursts.

Trigger or cron: builder's choice. An `after insert` trigger on
`event_schedule_snapshots` (0249's pattern: a warning, never an error) reacts
within seconds; a minute cron is simpler to test. Either way the snapshot must
never be lost over an entry.

### 4. The message

Every alarm is one Discord embed:

- **Title:** the entry's title ("Black Gold · Team A").
- **Description, in order:**
  1. the officer's message for this entry (`schedule_events.alarm_message`,
     new column), else the board's `message_template`, else nothing;
  2. one generated line, always present:
     - start alarm: `Starts <t:UNIX:F> (<t:UNIX:R>)`
     - open alarm: `Open now — closes <t:UNIX_END:F> (<t:UNIX_END:R>)`
     - close alarm: `Closes <t:UNIX_END:F> (<t:UNIX_END:R>)`

  Discord renders `<t:…>` in each reader's own time zone, and `R` is a live
  countdown, so the text is right for every member and never says "in 720
  minutes" when the job ran late.
- **Placeholders in an officer's message:** `{start}` → `<t:UNIX:F>`,
  `{in}` → `<t:UNIX:R>`, `{end}` → `<t:UNIX_END:F>`. Replaced at send time from
  the entry's CURRENT times. This is how an officer's message changes when the
  game changes the time (owner): the stored text never holds a time.
- **Length:** the composer trims the description to Discord's embed limit
  (4,096 characters; title 256) in SQL before it reaches the outbox, and the
  tab limits the message box below that. Discord rejects an oversized embed
  with a 400 and the database path does not trim today.
- **Ping (owner, 2026-11-13: ping a role).** A mention inside an embed never
  notifies anyone, so a pinging alarm also carries message `content`:
  `<@&ROLE_ID> Black Gold · Team A` — the role, then the title, so a phone's
  push notification says what it is about. The payload always sends
  `allowed_mentions: {"parse": [], "roles": ["ROLE_ID"]}`: only the board's
  role can be pinged, so `@everyone`, `@here` or another role typed into an
  officer's message shows as text and notifies nobody. A board with no
  `ping_role_id` posts the embed with no `content` and no ping, as today.
- **Which alarms ping:** every alarm from a board with a role — start, open,
  close, send now/later, and the moved-time follow-up (section 7) (my call:
  one setting per board, no per-step choice).
- Channels are webhooks (0130 posts to `notification_channels.webhook_url`),
  not a bot. Not verified here: whether a webhook can notify a role that is not
  set to "Allow anyone to @mention this role". The after-deploy test (Testing)
  settles it with a real member's phone; if it fails, the fix is that role
  setting, not code.

### 5. Send now, send later

From any entry in the Alarms tab, an officer writes a message and picks:

- **Default schedule:** the entry's alarms (section 1), carrying the message.
- **Send now:** a reminder row with `send_at = now()`; the minute job sends it.
- **Send later:** the same with a chosen `send_at`.

A one-off is tied to its entry, so it uses the entry's channel and its
placeholders render the entry's current times.

### 6. Stale and stuck alarms

- **Detection** keeps the 15-minute grace.
- **Delivery gains an age check for alarm rows** (new): an alarm row not
  delivered within 15 minutes of its fire time is marked expired and never
  sent, whatever the reason (channel disabled, outage). This closes today's
  hole where a disabled channel's rows go out late.
- **Expired or channel-less rows must not block other alerts**: delivery takes
  its batch from rows that can actually be sent (enabled channel, not expired),
  so ten stuck rows can no longer starve `sync_stalled` or `disk_high`.

### 7. When the game moves a time

- Pending alarms move by themselves (fire_at is computed from the entry).
- Text is rendered at send time (section 4).
- **Already-sent alarms: post a short follow-up, don't edit** (my call). When
  `starts_at` or `ends_at` of an entry changes and at least one of its alarms
  was already delivered, one message goes out:
  `**Zombie Siege moved** — now <t:UNIX:F> (<t:UNIX:R>)`. Editing the original
  would need the Discord message id, which delivery does not keep.
- A move of under 2 minutes is not announced (calendar re-reads jitter).

### 8. The Alarms tab

Under the alliance's Events hub (`EVENTS_HUB_TABS`, new route `#/alarms`).
Readable by members (`schedule.view`), editable by `schedule.manage` (site
officers and admins). Desktop and phone; officers plan on a PC.

- **Upcoming:** the next 14 days of entries for the reader's alliance, by
  start. Each row: title, board, time (reader's zone, server time beside it),
  source (game / alliance pick / manual), and a chip per alarm:
  `12h ✓ sent`, `1h · pending`, `5m · off`, `12h — skipped (too late)`.
- **Entry panel (officer):** message box with the placeholders listed, alarm
  chips to turn on/off, Send now, Send later (date-time), "back to board
  defaults".
- **Boards (officer):** each board's kind, channel, ping role, alarm steps and
  template; "Watch a game event" (section 3). The ping role is entered as a
  role ID (Discord: Developer Mode → right-click the role → Copy Role ID), with
  "use for every board" so one paste covers the alliance.
- **Warnings inline:** a board with no channel and no fallback (nothing will
  be sent); picks that could not be tied to an alliance (0249 stores those
  without an entry).

The archived `#/schedule` screen is superseded; reuse its pieces where they fit,
but not its delete-all save. Whether `#/schedule` keeps opening is the
builder's call.

## Constraints (this repo's rules that bite here)

- **Migration number** from `origin/main` at push time (today the newest is
  0321); run `scripts/check-migration-order.sh`.
- **Hosted grants:** new tables get `revoke all … from anon, authenticated`,
  then explicit grants; `service_role` grants are explicit; new functions
  `revoke execute … from anon` explicitly.
- **RLS:** officers write, members read, per alliance. pgTAP negative tests for
  each new write path, with `set local role` per role.
- **Triggers on captured data warn, never raise** (0249).
- **`pg_safeupdate`:** every UPDATE called through the API needs a WHERE.
- **One alliance's alarm never in another alliance's channel**: keep 0199's
  check.
- **Server day / game week** computations use the existing shared rule and its
  test vectors.
- Changing 0249's keying is a change to a trigger already in production:
  existing captured entries need their keys migrated, not duplicated.

## Testing

- pgTAP: rows created for every step; steps past at creation not sent, and
  revived when the time moves later; start/end anchors; open alarms; one-offs;
  the 15-minute grace at detection AND delivery; stuck rows not blocking other
  alerts; no duplicate after a reminder re-save; a pick moving to another day
  keeps the entry and its message; the moved-time follow-up (sent once, not for
  sub-2-minute jitter); Black Gold stages from a calendar fixture; no deletion
  on a missing activity; channel routing with and without a board channel;
  alliance isolation; trimming at the embed limit; negative RLS for members;
  the payload with a ping role (`content` + `allowed_mentions` naming only that
  role) and without one (no `content`); `@everyone` in an officer's message not
  added to `allowed_mentions`.
- Vitest: the tab's chip states and the placeholder rendering.
- Before merge: `pnpm db:test:local`, the full pnpm gate, and the `db` CI job.
- After deploy: one real event (the next Frankie or Siege) watched end to end in
  a test channel, with a test role held by one member who confirms the push
  notification arrived.

## Left to the builder

- Trigger vs cron for the calendar job; exact column names.
- Whether the moved-time follow-up is its own outbox event type.
- How much of the archived Schedule screen to reuse.
- The seeded template wording, within section 4's shape.

## My calls the owner should check

1. Before-close alarms use the same 12 h / 1 h / 5 m steps as start alarms.
2. "Roster selection" is my name for the gap between sign-up closing and the
   battle day opening.
3. A moved time is announced with a follow-up message rather than editing the
   old one; moves under 2 minutes are ignored.
4. A pick that moves to another day keeps its entry, message and history.
5. A step skipped as too late comes back if the game moves the event later.
6. Nothing is deleted or announced as cancelled because it vanished from one
   calendar reading.
7. Members see the Alarms tab read-only; only site officers/admins change it.
8. Entries are generated up to 14 days ahead.
9. Until an officer picks per-board channels, every alarm goes to the
   alliance's one reminder channel.
10. The ping role is set per board; every alarm from that board pings it
    (12 h, 1 h, 5 m, open, close, one-offs, moved notices). No per-step choice.
11. Only the board's role can ever be pinged; `@everyone` typed in a message
    stays silent.
