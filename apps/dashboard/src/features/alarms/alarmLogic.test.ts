import { describe, expect, test } from 'vitest';
import {
  type AlarmBoard,
  type AlarmStep,
  type Delivery,
  backToBoardDefaults,
  boardDefaultSteps,
  checkEntry,
  chipFor,
  chipText,
  entrySource,
  nothingWillBeSent,
  orderSteps,
  pingRole,
  previewMessage,
  reminderDiff,
  silenceReason,
  stepKey,
  stepMinutes,
  wholeSecond,
} from './alarmLogic';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date('2026-11-20T12:00:00Z');
// Relative steps read the same in every zone; only a one-off's time differs.
const ZONE = 'UTC';
const iso = (ms: number) => new Date(ms).toISOString();
// The event started half an hour ago, so its 1 h alarm went out 90 minutes ago.
const START = iso(NOW.getTime() - 30 * MIN);

const startStep = (minutesBefore: number, reminderId: string | null = null): AlarmStep => ({
  reminderId,
  anchor: 'start',
  minutesBefore,
  sendAt: null,
  enabled: true,
});
const endStep = (minutesBefore: number, reminderId: string | null = null): AlarmStep => ({
  ...startStep(minutesBefore, reminderId),
  anchor: 'end',
});
const onceStep = (sendAt: string, reminderId: string | null = null): AlarmStep => ({
  reminderId,
  anchor: 'start',
  minutesBefore: null,
  sendAt,
  enabled: true,
});

const s720 = startStep(720, 'r-720');
const s60 = startStep(60, 'r-60');
const s5 = startStep(5, 'r-5');
const step720 = s720;
const step60 = s60;

const entryMovedBy = (ms: number) => ({ startsAt: iso(Date.parse(START) + ms), endsAt: null });
const entryIn = (ms: number) => ({ startsAt: iso(NOW.getTime() + ms), endsAt: null });
const delivered = (alarmStep: string, anchorAt: string): Delivery => ({
  alarmStep,
  anchorAt,
  deliveredAt: iso(NOW.getTime() - 90 * MIN),
  expiredAt: null,
});

const board = (patch: Partial<AlarmBoard>): AlarmBoard => ({
  category: 'game_zombie_siege',
  label: 'Zombie Siege',
  kind: 'point',
  channel: null,
  pingRoleId: null,
  startReminders: [720, 60, 5],
  closeReminders: [720, 60, 5],
  alarmOnOpen: true,
  messageTemplate: null,
  activityId: null,
  activityStage: 'main',
  sortOrder: 100,
  ...patch,
});

describe('chipFor', () => {
  test('a sent step stays sent when the time moved by under 2 minutes', () => {
    expect(
      chipFor(step60, entryMovedBy(90_000), [delivered('start:60', START)], NOW, ZONE).state,
    ).toBe('sent');
  });

  test('a step whose time moved by hours is pending again', () => {
    expect(
      chipFor(step60, entryMovedBy(3 * HOUR), [delivered('start:60', START)], NOW, ZONE).state,
    ).toBe('pending');
  });

  test('a past, unsent step reads as skipped; a turned-off one as off', () => {
    expect(chipFor(step720, entryIn(30 * MIN), [], NOW, ZONE)).toEqual({
      label: '12h',
      state: 'skipped',
    });
    expect(chipFor({ ...step60, enabled: false }, entryIn(DAY), [], NOW, ZONE).state).toBe('off');
  });

  test('a step inside the 15-minute grace is still pending', () => {
    // 5 m before a start 2 minutes ago: due 7 minutes ago, the detector still takes it.
    expect(chipFor(s5, entryIn(-2 * MIN), [], NOW, ZONE).state).toBe('pending');
  });

  test('a delivery the database dropped as too late reads as skipped', () => {
    const expired: Delivery = {
      alarmStep: 'start:5',
      anchorAt: iso(NOW.getTime() - 2 * MIN),
      deliveredAt: null,
      expiredAt: iso(NOW.getTime()),
    };
    expect(chipFor(s5, entryIn(-2 * MIN), [expired], NOW, ZONE).state).toBe('skipped');
  });

  test('a one-off is sent once, whatever happened to the entry since', () => {
    const sendAt = iso(NOW.getTime() - 10 * MIN);
    const once = onceStep(sendAt, 'r-once');
    expect(
      chipFor(once, entryMovedBy(3 * HOUR), [delivered(stepKey(once), START)], NOW, ZONE).state,
    ).toBe('sent');
  });

  test('a close step on an entry with no end can never fire', () => {
    expect(chipFor(endStep(60), entryIn(DAY), [], NOW, ZONE).state).toBe('skipped');
  });

  test('labels: steps, open, close and a one-off in the reader zone', () => {
    const window = { startsAt: iso(NOW.getTime() + DAY), endsAt: iso(NOW.getTime() + 2 * DAY) };
    expect(chipFor(s5, window, [], NOW, ZONE).label).toBe('5m');
    expect(chipFor(startStep(90), window, [], NOW, ZONE).label).toBe('1h30m');
    expect(chipFor(startStep(0), window, [], NOW, ZONE).label).toBe('open');
    expect(chipFor(endStep(60), window, [], NOW, ZONE).label).toBe('close 1h');
    expect(chipFor(endStep(0), window, [], NOW, ZONE).label).toBe('close');
    expect(chipFor(onceStep('2026-11-20T12:00:00.000Z'), window, [], NOW, 'Asia/Seoul').label).toBe(
      'Nov 20 21:00',
    );
  });
});

describe('chipText', () => {
  test('says what happened to each step, as the spec words it', () => {
    expect(chipText({ label: '12h', state: 'sent' })).toBe('12h ✓ sent');
    expect(chipText({ label: '1h', state: 'pending' })).toBe('1h · pending');
    expect(chipText({ label: '5m', state: 'off' })).toBe('5m · off');
    expect(chipText({ label: '12h', state: 'skipped' })).toBe('12h — skipped (too late)');
  });
});

describe('stepKey', () => {
  test('matches the database alarm_step for every kind of step', () => {
    expect(stepKey(s60)).toBe('start:60');
    expect(stepKey(endStep(5))).toBe('end:5');
    expect(stepKey(startStep(0))).toBe('start:0');
    expect(stepKey(onceStep('2026-11-20T12:00:00.000Z'))).toBe('once:1795176000');
  });

  test('a send_at written through wholeSecond keys exactly like the database', () => {
    const written = wholeSecond(new Date('2026-11-20T12:00:00.987Z'));
    expect(written).toBe('2026-11-20T12:00:00.000Z');
    expect(stepKey(onceStep(written))).toBe('once:1795176000');
  });
});

describe('reminderDiff', () => {
  test('reminderDiff keeps unchanged rows and removes only dropped steps', () => {
    expect(reminderDiff([s720, s60, s5], [s720, { ...s60, enabled: false }])).toEqual({
      update: [{ ...s60, enabled: false }],
      insert: [],
      remove: [s5.reminderId],
    });
  });

  test('a desired step without an id is matched to the existing row by its key', () => {
    const fresh = startStep(30);
    expect(
      reminderDiff([s720, s60], [startStep(720), { ...startStep(60), enabled: false }, fresh]),
    ).toEqual({
      update: [{ ...s60, enabled: false }],
      insert: [fresh],
      remove: [],
    });
  });

  test('a step asked for twice is inserted once', () => {
    expect(reminderDiff([], [startStep(30), startStep(30)]).insert).toEqual([startStep(30)]);
  });
});

describe('previewMessage', () => {
  test('previewMessage renders placeholders in the reader zone', () => {
    expect(previewMessage('At {start}', '2026-11-20T12:00:00Z', null, 'Asia/Seoul')).toContain(
      '21:00',
    );
  });

  test('{in} counts down from now and a missing end renders as nothing, as in SQL', () => {
    const startsAt = iso(NOW.getTime() + 2 * HOUR);
    expect(previewMessage('Go {in}; closes {end}.', startsAt, null, 'UTC', NOW)).toBe(
      'Go in 2 hours; closes .',
    );
    expect(previewMessage('{end}', startsAt, '2026-11-21T00:00:00Z', 'UTC', NOW)).toBe(
      'Saturday, November 21, 2026 00:00',
    );
  });
});

describe('board defaults', () => {
  test('a point board gives its start steps only, all on', () => {
    expect(boardDefaultSteps(board({})).map(stepKey)).toEqual(['start:720', 'start:60', 'start:5']);
    expect(boardDefaultSteps(board({})).every((s) => s.enabled && s.reminderId === null)).toBe(
      true,
    );
  });

  test('a window board opens, then counts down to its close', () => {
    const steps = boardDefaultSteps(board({ kind: 'window', startReminders: [] }));
    expect(steps.map(stepKey)).toEqual(['start:0', 'end:720', 'end:60', 'end:5']);
    const quiet = board({ kind: 'window', startReminders: [60], alarmOnOpen: false });
    expect(boardDefaultSteps(quiet).map(stepKey)).toEqual([
      'start:60',
      'end:720',
      'end:60',
      'end:5',
    ]);
  });

  test('back to board defaults resets the steps and keeps the one-offs', () => {
    const once = onceStep('2026-11-20T12:00:00.000Z', 'r-once');
    const current = [{ ...s60, enabled: false }, startStep(30, 'r-30'), once];
    const reset = backToBoardDefaults(current, board({}));
    expect(reset.map(stepKey)).toEqual(['start:720', 'start:60', 'start:5', stepKey(once)]);
    expect(reminderDiff(current, reset)).toEqual({
      update: [{ ...s60, enabled: true }],
      insert: [startStep(720), startStep(5)],
      remove: ['r-30'],
    });
  });
});

describe('silenceReason', () => {
  test('names the switched-off channel, or the missing one', () => {
    expect(silenceReason('old-alarms')).toMatch(/^#old-alarms is switched off/);
    expect(silenceReason(null)).toMatch(/^this board has no channel/);
    expect(silenceReason('')).toMatch(/^this board has no channel/);
  });
});

describe('nothingWillBeSent', () => {
  const enabled = ['siege', 'alliance-alerts'];
  const on = { enabled: true, channel: 'alliance-alerts' };

  test('a board channel that is switched on is enough', () => {
    expect(nothingWillBeSent('siege', enabled, null)).toBe(false);
  });

  test('a board on a switched-off channel sends nothing: it never falls back', () => {
    expect(nothingWillBeSent('switched-off', enabled, on)).toBe(true);
    expect(nothingWillBeSent('switched-off', [], { enabled: true, channel: '' })).toBe(true);
  });

  test('a board with no channel uses the routing, when it is on and its channel is too', () => {
    expect(nothingWillBeSent(null, enabled, on)).toBe(false);
    expect(nothingWillBeSent('', enabled, on)).toBe(false);
    expect(nothingWillBeSent(null, ['siege'], on)).toBe(true);
    expect(nothingWillBeSent(null, enabled, null)).toBe(true);
    expect(nothingWillBeSent(null, enabled, { enabled: false, channel: 'alliance-alerts' })).toBe(
      true,
    );
    expect(nothingWillBeSent(null, enabled, { enabled: true, channel: '' })).toBe(true);
    expect(nothingWillBeSent(null, enabled, 'not an object')).toBe(true);
  });
});

describe('entrySource', () => {
  test('calendar entries are the game, other captured ones are picks', () => {
    expect(entrySource({ source: 'captured', sourceKey: 'cal:111001:main:1795176000' })).toBe(
      'game',
    );
    expect(entrySource({ source: 'captured', sourceKey: 'zombie_siege:1:2026-11-20' })).toBe(
      'pick',
    );
    expect(entrySource({ source: 'manual', sourceKey: null })).toBe('manual');
  });
});

describe('orderSteps', () => {
  test('start steps longest first, then the open, the close steps, then one-offs', () => {
    const once = onceStep('2026-11-20T12:00:00.000Z');
    const ordered = orderSteps([once, endStep(5), s5, startStep(0), s720, endStep(60)]);
    expect(ordered.map(stepKey)).toEqual([
      'start:720',
      'start:5',
      'start:0',
      'end:60',
      'end:5',
      stepKey(once),
    ]);
  });
});

describe('what the writes accept', () => {
  test('board steps are whole minutes up to two weeks, each once, longest first', () => {
    expect(stepMinutes([5, 720, 60, 60])).toEqual([720, 60, 5]);
    expect(stepMinutes([])).toEqual([]);
    expect(() => stepMinutes([20_161])).toThrow();
    expect(() => stepMinutes([-1])).toThrow();
    expect(() => stepMinutes([1.5])).toThrow();
  });

  test('a ping role is a Discord role ID or nothing', () => {
    expect(pingRole(' 123456789012345678 ')).toBe('123456789012345678');
    expect(pingRole('')).toBeNull();
    expect(pingRole(null)).toBeNull();
    expect(() => pingRole('@everyone')).toThrow();
    expect(() => pingRole('1234')).toThrow();
  });

  test('a manual entry needs a title, a start, and an end after its start', () => {
    const at = '2026-11-20T12:00:00.000Z';
    expect(checkEntry({ title: ' Server Clash ', startsAt: at, endsAt: null })).toBe(
      'Server Clash',
    );
    expect(() => checkEntry({ title: '  ', startsAt: at, endsAt: null })).toThrow();
    expect(() => checkEntry({ title: 'x', startsAt: '', endsAt: null })).toThrow();
    expect(() => checkEntry({ title: 'x', startsAt: at, endsAt: at })).toThrow();
  });
});
