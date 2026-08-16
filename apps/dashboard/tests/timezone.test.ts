import { describe, expect, test } from 'vitest';
import {
  fromInputValue,
  toInputValue,
  zoneLabel,
  zonedDayKey,
  zonedTime,
} from '../src/lib/timezone';

/** Converting between an instant and somebody's wall clock.
 *
 * The bug this file exists to prevent is not a wrong hour — a wrong hour is
 * visible. It is a right hour in the wrong CELL: an entry at 20:00 UTC is the
 * 21st in Seoul, so a calendar that prints the time in Seoul and buckets the
 * day in UTC shows "05:00" under the 20th and looks entirely plausible.
 */

const BEAR = '2026-08-20T20:00:00+00:00';

describe('reading an instant in a zone', () => {
  test('the day can be a different day', () => {
    expect(zonedDayKey(BEAR, 'UTC')).toBe('2026-08-20');
    expect(zonedDayKey(BEAR, 'Asia/Seoul')).toBe('2026-08-21');
    expect(zonedDayKey(BEAR, 'America/Los_Angeles')).toBe('2026-08-20');
  });

  test('and the clock face moves with it', () => {
    expect(zonedTime(BEAR, 'UTC')).toBe('20:00');
    expect(zonedTime(BEAR, 'Asia/Seoul')).toBe('05:00');
    expect(zonedTime(BEAR, 'America/New_York')).toBe('16:00');
  });

  test('midnight does not roll into the next day', () => {
    // `hour12: false` reports midnight as 24 in some engines. Left alone that
    // adds a day, and the entry disappears from the cell somebody is looking at.
    const midnight = '2026-08-20T15:00:00+00:00'; // 00:00 on the 21st in Seoul
    expect(zonedTime(midnight, 'Asia/Seoul')).toBe('00:00');
    expect(zonedDayKey(midnight, 'Asia/Seoul')).toBe('2026-08-21');
  });
});

describe('writing a wall clock back', () => {
  test('round-trips through the form field', () => {
    for (const zone of ['UTC', 'Asia/Seoul', 'Europe/Paris', 'America/New_York']) {
      expect(fromInputValue(toInputValue(BEAR, zone), zone)).toBe('2026-08-20T20:00:00.000Z');
    }
  });

  test('20:00 typed in Seoul is 11:00 UTC, not 20:00 UTC', () => {
    // The whole point of the feature. Typed into the old UTC-only editor, an
    // officer in Seoul scheduling "20:00" got a reminder at 05:00 their time.
    expect(fromInputValue('2026-08-20T20:00', 'Asia/Seoul')).toBe('2026-08-20T11:00:00.000Z');
  });

  test('summer and winter differ in a zone that changes its clocks', () => {
    // Paris is UTC+2 in July and UTC+1 in January. A cached offset puts every
    // entry in one half of the year an hour out.
    expect(fromInputValue('2026-07-15T12:00', 'Europe/Paris')).toBe('2026-07-15T10:00:00.000Z');
    expect(fromInputValue('2026-01-15T12:00', 'Europe/Paris')).toBe('2026-01-15T11:00:00.000Z');
  });

  test('an empty field is not a time', () => {
    expect(fromInputValue('', 'Asia/Seoul')).toBeNull();
    expect(fromInputValue('   ', 'Asia/Seoul')).toBeNull();
  });
});

describe('labels', () => {
  test('survive an instant that has milliseconds on it', () => {
    // The regression this catches shipped to a browser and was caught by
    // looking at the screen: every fixture above lands on a whole second, and
    // `new Date()` does not. The offset came back as 8:59.99223333333339 hours
    // and the picker said so, in the dropdown, to everybody.
    const messy = new Date('2026-08-20T20:00:00.437Z');
    expect(zoneLabel('Asia/Seoul', messy)).toBe('Asia/Seoul (UTC+9)');
    expect(zoneLabel('UTC', messy)).toBe('UTC');
  });

  test('say which way the offset goes', () => {
    expect(zoneLabel('UTC', new Date(BEAR))).toBe('UTC');
    expect(zoneLabel('Asia/Seoul', new Date(BEAR))).toBe('Asia/Seoul (UTC+9)');
    expect(zoneLabel('Asia/Kolkata', new Date(BEAR))).toBe('Asia/Kolkata (UTC+5:30)');
    expect(zoneLabel('America/New_York', new Date(BEAR))).toBe('America/New_York (UTC−4)');
  });
});
