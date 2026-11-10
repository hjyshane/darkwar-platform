import { describe, expect, it } from 'vitest';
import { captureLed, powerDelta, rosterLed, signedCompact } from './header';

const NOW = new Date('2026-11-09T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe('rosterLed', () => {
  it('is absent when no roster was ever captured', () => {
    expect(rosterLed(null, NOW)).toBeNull();
  });
  it('is ok under 48 hours', () => {
    expect(rosterLed(hoursAgo(47), NOW)).toMatchObject({ tone: 'ok', text: 'Roster 1d' });
  });
  it('warns at 48 hours and past it', () => {
    expect(rosterLed(hoursAgo(48), NOW)).toMatchObject({ tone: 'warn', text: 'Roster 2d' });
    expect(rosterLed(hoursAgo(24 * 9), NOW)?.tone).toBe('warn');
  });
  it('reads a capture from this minute without an age unit', () => {
    expect(rosterLed(hoursAgo(0), NOW)?.text).toBe('Roster just now');
  });
});

describe('captureLed', () => {
  it('has nothing to say about a last-known list', () => {
    expect(captureLed('last known', true)).toBeNull();
  });
  it('is ok for a finished capture', () => {
    expect(captureLed('roster', true)).toMatchObject({ tone: 'ok', text: 'Capture complete' });
  });
  it('is bad for one that was cut short', () => {
    expect(captureLed('roster', false)).toMatchObject({ tone: 'bad', text: 'Capture cut short' });
  });
});

describe('powerDelta', () => {
  it('compares the newest reading with the newest one at least seven days back', () => {
    const readings = [
      { captured_at: hoursAgo(24 * 10), power: 900 },
      { captured_at: hoursAgo(24 * 8), power: 1000 },
      { captured_at: hoursAgo(24 * 3), power: 1100 },
      { captured_at: hoursAgo(1), power: 1250 },
    ];
    expect(powerDelta(readings, NOW)).toBe(250);
  });
  it('can be negative and does not need the input ordered', () => {
    const readings = [
      { captured_at: hoursAgo(1), power: 800 },
      { captured_at: hoursAgo(24 * 7), power: 1000 },
    ];
    expect(powerDelta(readings, NOW)).toBe(-200);
  });
  it('gives nothing when no reading is old enough', () => {
    const readings = [
      { captured_at: hoursAgo(24 * 2), power: 1000 },
      { captured_at: hoursAgo(1), power: 1200 },
    ];
    expect(powerDelta(readings, NOW)).toBeNull();
  });
  it('skips readings with no power or no time', () => {
    const readings = [
      { captured_at: hoursAgo(24 * 9), power: null },
      { captured_at: hoursAgo(24 * 8), power: 500 },
      { captured_at: null, power: 99 },
      { captured_at: hoursAgo(2), power: 700 },
      { captured_at: hoursAgo(1), power: null },
    ];
    expect(powerDelta(readings, NOW)).toBe(200);
  });
  it('gives nothing for an empty history', () => {
    expect(powerDelta([], NOW)).toBeNull();
  });
});

describe('signedCompact', () => {
  it('signs a gain and a loss the way the game writes big numbers', () => {
    expect(signedCompact(1_200_000_000)).toBe('+1.2G');
    expect(signedCompact(-340_000_000)).toBe('-340M');
  });
  it('leaves zero unsigned', () => {
    expect(signedCompact(0)).toBe('0');
  });
});
