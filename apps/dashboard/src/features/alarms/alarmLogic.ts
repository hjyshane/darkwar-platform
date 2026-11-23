import { toInputValue, zonedTime } from '../../lib/timezone';

/** The Alarms tab's rules, with no database in sight (spec §1, §4, §8).
 *
 * Every rule here restates one the DATABASE applies when it sends — the step
 * key (0323's `alarm_step`), the ±2-minute "already sent" match, the 15-minute
 * grace, the placeholder rendering — so the tab says what the minute job will
 * do. Change one side and the other has to follow, or a chip lies.
 */

export type Anchor = 'start' | 'end';

/** One `schedule_reminders` row. `sendAt` set means a one-off ("send now /
 *  later"); otherwise `minutesBefore` counts back from the anchor. */
export interface AlarmStep {
  reminderId: string | null;
  anchor: Anchor;
  minutesBefore: number | null;
  sendAt: string | null;
  enabled: boolean;
}

/** One queued alarm, from `alarm_deliveries` (0324). */
export interface Delivery {
  alarmStep: string;
  anchorAt: string;
  deliveredAt: string | null;
  expiredAt: string | null;
}

/** `noend`: a close step on an entry with no end, which can never fire.
 *  `unknown`: due already, but what the minute job did is not read yet. */
export type ChipState = 'sent' | 'pending' | 'off' | 'skipped' | 'noend' | 'unknown';

export interface Chip {
  label: string;
  state: ChipState;
}

export interface EntryTimes {
  startsAt: string;
  endsAt: string | null;
}

/** A `schedule_events` row on the tab, with its steps. */
export interface AlarmEntry extends EntryTimes {
  id: string;
  title: string;
  category: string | null;
  source: string;
  sourceKey: string | null;
  alarmMessage: string | null;
  /** An officer set a game entry's times by hand; the game's readings leave them (0344). */
  timesLocked: boolean;
  steps: AlarmStep[];
}

/** A `schedule_categories` row: a board and how its entries speak. */
export interface AlarmBoard {
  category: string;
  label: string;
  kind: 'point' | 'window';
  channel: string | null;
  pingRoleId: string | null;
  startReminders: number[];
  closeReminders: number[];
  alarmOnOpen: boolean;
  messageTemplate: string | null;
  activityId: string | null;
  activityStage: string;
  sortOrder: number;
}

/** What 0322's constraint accepts as a ping role: a Discord role ID. */
export const PING_ROLE_ID = /^[0-9]{17,20}$/;

/** 0322's bounds on a step: up to two weeks before. */
export const MAX_MINUTES_BEFORE = 20_160;

/** The message box's limit: Discord takes 4,096 in an embed description and
 *  0323 adds the time line after the message, so this leaves it room (§4). */
export const MESSAGE_MAX = 3_900;

/** Entries are generated, and listed, two weeks ahead (spec §3). The tab's
 *  list, its look-back for unplaced picks and the manual-entry check all
 *  read this one number. */
export const AHEAD_DAYS = 14;
export const AHEAD_MS = AHEAD_DAYS * 86_400_000;

const MINUTE_MS = 60_000;
/** A move under this is calendar jitter: the sent alarm still counts (0323). */
const SAME_TIME_MS = 2 * MINUTE_MS;
/** The detector's grace: a step later than this is never sent (0323, 0324). */
const GRACE_MS = 15 * MINUTE_MS;

/** Moved here from the schedule screen, which the Alarms tab replaces. */
export function toLocal(iso: string | null, zone: string): string {
  return toInputValue(iso, zone);
}

/** An instant with its milliseconds dropped, as ISO.
 *
 * EVERY `send_at` THE DASHBOARD WRITES GOES THROUGH THIS. The database keys a
 * one-off by its epoch rounded to the second; a stored `.987` rounds up, the
 * key here would have to guess the same way, and a chip that guesses wrong
 * shows a sent message as pending forever.
 */
export function wholeSecond(at: Date): string {
  return new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString();
}

/** The step's identity, exactly as 0323 writes `notification_outbox.alarm_step`. */
export function stepKey(step: AlarmStep): string {
  if (step.sendAt !== null) {
    // `extract(epoch …)::bigint` rounds half away from zero; for any instant
    // after 1970 that is Math.round.
    return `once:${Math.round(Date.parse(step.sendAt) / 1000)}`;
  }
  return `${step.anchor}:${step.minutesBefore ?? 0}`;
}

function duration(minutes: number): string {
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  if (minutes > 60) {
    return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
  }
  return `${minutes}m`;
}

/** `Nov 20 21:00` in the zone. */
export function shortDate(iso: string, zone: string): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' });
  return `${day.format(new Date(iso))} ${zonedTime(iso, zone)}`;
}

/** `12h`, `5m`, `open`, `close 1h`, or a one-off's time in the reader's zone.
 *  The zone is required: a one-off read in somebody else's clock is wrong. */
export function stepLabel(step: AlarmStep, zone: string): string {
  if (step.sendAt !== null) {
    return shortDate(step.sendAt, zone);
  }
  const minutes = step.minutesBefore ?? 0;
  if (step.anchor === 'start') {
    return minutes === 0 ? 'open' : duration(minutes);
  }
  return minutes === 0 ? 'close' : `close ${duration(minutes)}`;
}

function anchorMs(step: AlarmStep, entry: EntryTimes): number | null {
  const at = step.anchor === 'start' ? entry.startsAt : entry.endsAt;
  return at === null ? null : Date.parse(at);
}

/** When the step goes out at the entry's CURRENT times; null when it cannot
 *  (a close step on an entry with no end). */
function fireMs(step: AlarmStep, entry: EntryTimes): number | null {
  if (step.sendAt !== null) {
    return Date.parse(step.sendAt);
  }
  const anchor = anchorMs(step, entry);
  return anchor === null ? null : anchor - (step.minutesBefore ?? 0) * MINUTE_MS;
}

/** The chip for one step: what the minute job has done, or will do, with it.
 *
 * A delivery counts only for (nearly) the same anchor time: when the game moves
 * the event by hours, the step is due again at the new time, as 0323 decides.
 * A one-off is the exception — it goes out once, whatever moves afterwards.
 *
 * `deliveries` is null until `alarm_deliveries` has answered (or when it
 * failed). A step already due then reads `unknown`, never `skipped`: calling
 * a sent alarm "too late" is the one lie a reader would act on. A step more
 * than two minutes ahead is `pending` either way — nothing can have gone out
 * for it, since a sent one only counts within two minutes of its anchor.
 */
export function chipFor(
  step: AlarmStep,
  entry: EntryTimes,
  deliveries: readonly Delivery[] | null,
  now: Date,
  zone: string,
): Chip {
  const label = stepLabel(step, zone);
  if (!step.enabled) {
    return { label, state: 'off' };
  }
  const fire = fireMs(step, entry);
  if (fire === null) {
    return { label, state: 'noend' };
  }
  if (deliveries === null) {
    return { label, state: fire - now.getTime() > SAME_TIME_MS ? 'pending' : 'unknown' };
  }
  const key = stepKey(step);
  const anchor = anchorMs(step, entry);
  const matching = deliveries.filter(
    (d) =>
      d.alarmStep === key &&
      (step.sendAt !== null ||
        (anchor !== null && Math.abs(Date.parse(d.anchorAt) - anchor) < SAME_TIME_MS)),
  );
  if (matching.some((d) => d.deliveredAt !== null)) {
    return { label, state: 'sent' };
  }
  if (now.getTime() - fire > GRACE_MS || matching.some((d) => d.expiredAt !== null)) {
    return { label, state: 'skipped' };
  }
  return { label, state: 'pending' };
}

const CHIP_TEXT: Record<ChipState, string> = {
  sent: '✓ sent',
  pending: '· pending',
  off: '· off',
  skipped: '— skipped (too late)',
  noend: '— no end time',
  unknown: '· …',
};

/** `12h ✓ sent`, `1h · pending`, `5m · off`, `12h — skipped (too late)`. */
export function chipText(chip: Chip): string {
  return `${chip.label} ${CHIP_TEXT[chip.state]}`;
}

/** How to turn the rows there are into the rows wanted, matched by `stepKey`.
 *
 * A DIFF, NEVER DELETE-ALL (spec §1): a matched row keeps its id and is updated
 * only when its switch changed, and a row is removed only when its step is no
 * longer wanted at all.
 */
export function reminderDiff(
  current: readonly AlarmStep[],
  desired: readonly AlarmStep[],
): { update: AlarmStep[]; insert: AlarmStep[]; remove: string[] } {
  const byKey = new Map(current.map((step) => [stepKey(step), step]));
  const wanted = new Set<string>();
  const update: AlarmStep[] = [];
  const insert: AlarmStep[] = [];
  for (const step of desired) {
    const key = stepKey(step);
    if (wanted.has(key)) {
      continue;
    }
    wanted.add(key);
    const have = byKey.get(key);
    if (have === undefined) {
      insert.push(step);
    } else if (have.enabled !== step.enabled) {
      update.push({ ...step, reminderId: have.reminderId });
    }
  }
  const remove = current
    .filter((step) => !wanted.has(stepKey(step)))
    .map((step) => step.reminderId)
    .filter((id): id is string => id !== null);
  return { update, insert, remove };
}

const startOf = (minutesBefore: number): AlarmStep => ({
  reminderId: null,
  anchor: 'start',
  minutesBefore,
  sendAt: null,
  enabled: true,
});

/** The steps a board gives a new entry — what 0322's seed_alarm_steps inserts. */
export function boardDefaultSteps(
  board: Pick<AlarmBoard, 'kind' | 'startReminders' | 'closeReminders' | 'alarmOnOpen'>,
): AlarmStep[] {
  const steps = board.startReminders.map(startOf);
  if (board.kind === 'window') {
    if (board.alarmOnOpen) {
      steps.push(startOf(0));
    }
    steps.push(...board.closeReminders.map((m): AlarmStep => ({ ...startOf(m), anchor: 'end' })));
  }
  // A window board listing 0 among its start steps AND opening alarms gets
  // one `start:0` row, as the seed's `on conflict do nothing` gives it.
  const byKey = new Map(steps.map((step) => [stepKey(step), step]));
  return [...byKey.values()];
}

/** "Back to board defaults": the board's steps, all on, plus the one-offs
 *  already filed — those were somebody's decision, not a default. */
export function backToBoardDefaults(
  current: readonly AlarmStep[],
  board: Pick<AlarmBoard, 'kind' | 'startReminders' | 'closeReminders' | 'alarmOnOpen'>,
): AlarmStep[] {
  return [...boardDefaultSteps(board), ...current.filter((step) => step.sendAt !== null)];
}

/** Chip order: start steps longest first (the open last of them), close
 *  steps likewise, then one-offs by time. */
export function orderSteps(steps: readonly AlarmStep[]): AlarmStep[] {
  const rank = (step: AlarmStep) => (step.sendAt !== null ? 2 : step.anchor === 'start' ? 0 : 1);
  return [...steps].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.minutesBefore ?? 0) - (a.minutesBefore ?? 0) ||
      (a.sendAt ?? '').localeCompare(b.sendAt ?? ''),
  );
}

function longDate(iso: string, zone: string): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${day.format(new Date(iso))} ${zonedTime(iso, zone)}`;
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

function relative(iso: string, now: Date): string {
  const seconds = (Date.parse(iso) - now.getTime()) / 1000;
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? ['second', 1];
  return format.format(Math.sign(seconds) * Math.round(Math.abs(seconds) / size), unit);
}

/** An officer's message as members will read it.
 *
 * Discord renders `<t:…:F>` and `<t:…:R>` in each reader's own zone; this
 * renders them in the zone the tab is showing. A missing end is an empty
 * string, as 0323's `alarm_render` makes it.
 */
export function previewMessage(
  text: string,
  startsAt: string,
  endsAt: string | null,
  zone: string,
  now: Date = new Date(),
): string {
  return text
    .replaceAll('{start}', longDate(startsAt, zone))
    .replaceAll('{in}', relative(startsAt, now))
    .replaceAll('{end}', endsAt === null ? '' : longDate(endsAt, zone));
}

/** Whether a board's alarms reach nobody.
 *
 * A BOARD WITH A CHANNEL NEVER FALLS BACK: 0323's `alarm_route` takes the
 * board's channel without asking whether it is switched on, and 0324 delivers
 * only to switched-on channels — so a board on a switched-off channel is
 * silent whatever the routing says. Only a board with no channel uses the
 * alliance's `schedule_reminder` routing, and that has to be on and name a
 * switched-on channel. Anything else stored there counts as off.
 */
export function nothingWillBeSent(
  boardChannel: string | null,
  enabledChannels: readonly string[],
  reminderRouting: unknown,
): boolean {
  if (boardChannel !== null && boardChannel !== '') {
    return !enabledChannels.includes(boardChannel);
  }
  if (typeof reminderRouting !== 'object' || reminderRouting === null) {
    return true;
  }
  const { enabled, channel } = reminderRouting as { enabled?: unknown; channel?: unknown };
  return !(
    enabled === true &&
    typeof channel === 'string' &&
    channel !== '' &&
    enabledChannels.includes(channel)
  );
}

/** Why `nothingWillBeSent` said so, for the warning beside the board. */
export function silenceReason(boardChannel: string | null): string {
  return boardChannel === null || boardChannel === ''
    ? "this board has no channel, and the alliance's reminder channel is off or switched off. Pick a channel for the board."
    : `#${boardChannel} is switched off or gone, and a board with a channel never falls back. Pick another.`;
}

/** Board steps as 0322's checks accept them: whole minutes up to two weeks,
 *  each once, longest first. Throws rather than quietly dropping a typo. */
export function stepMinutes(values: readonly number[]): number[] {
  if (!values.every((m) => Number.isInteger(m) && m >= 0 && m <= MAX_MINUTES_BEFORE)) {
    throw new Error(`Alarm steps are whole minutes from 0 to ${MAX_MINUTES_BEFORE}.`);
  }
  return [...new Set(values)].sort((a, b) => b - a);
}

/** A ping role as stored: a role ID, or null for no ping. */
export function pingRole(value: string | null): string | null {
  const role = value?.trim() ?? '';
  if (role !== '' && !PING_ROLE_ID.test(role)) {
    throw new Error('A ping role is a Discord role ID: 17 to 20 digits.');
  }
  return role === '' ? null : role;
}

export interface EntryTimesDraft {
  title: string;
  startsAt: string;
  endsAt: string | null;
}

/** A manual entry's trimmed title, or why it cannot be saved.
 *
 * ONLY WHAT THE LIST WILL SHOW. The tab lists entries still to start or still
 * open, starting within `AHEAD_DAYS`; one saved outside that disappears the
 * moment it is saved, and the officer adds it again — two entries, two sets of
 * alarms. So it is refused here, by the same numbers the list uses.
 */
export function checkEntry(draft: EntryTimesDraft, now: Date = new Date()): string {
  const title = draft.title.trim();
  if (title === '') {
    throw new Error('An entry needs a title.');
  }
  const starts = Date.parse(draft.startsAt);
  if (Number.isNaN(starts)) {
    throw new Error('An entry needs a start time.');
  }
  const ends = draft.endsAt === null ? null : Date.parse(draft.endsAt);
  if (ends !== null && !(ends > starts)) {
    throw new Error('An entry has to end after it starts.');
  }
  if (starts >= now.getTime() + AHEAD_MS) {
    throw new Error(
      `Only the next ${AHEAD_DAYS} days are listed, so this entry would not show. Add it nearer the time.`,
    );
  }
  if ((ends ?? starts) < now.getTime()) {
    throw new Error('That time has already passed: the entry would not show.');
  }
  return title;
}

/** Where an entry came from: the game's calendar (0325 keys those `cal:`), an
 *  alliance pick (0249), or somebody typing it. */
export function entrySource(
  entry: Pick<AlarmEntry, 'source' | 'sourceKey'>,
): 'game' | 'pick' | 'manual' {
  if (entry.source !== 'captured') {
    return 'manual';
  }
  return entry.sourceKey?.startsWith('cal:') ? 'game' : 'pick';
}
