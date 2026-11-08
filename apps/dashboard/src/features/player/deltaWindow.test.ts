import { describe, expect, it } from 'vitest';
import { type HistoryRow, killsDelta, powerDelta, retentionWindowDays } from './deltaWindow';

const at = (day: string) => `${day}T02:05:00Z`;
const power = (day: string, value: number): HistoryRow => ({
  captured_at: at(day),
  power: value,
  kills: null,
  source_command: 'server.rank',
});
const kills = (day: string, value: number): HistoryRow => ({
  captured_at: at(day),
  power: null,
  kills: value,
  source_command: 'kill.rank',
});

describe('retentionWindowDays', () => {
  it('is 30 days for our own members and 7 for everyone else', () => {
    expect(retentionWindowDays(true)).toBe(30);
    expect(retentionWindowDays(false)).toBe(7);
  });
});

describe('powerDelta', () => {
  it('is newest minus oldest inside the window, with both ends', () => {
    expect(
      powerDelta(
        [
          power('2026-11-01', 1_000_000_000),
          power('2026-10-10', 940_600_000),
          power('2026-11-08', 1_000_000_000),
        ],
        30,
      ),
    ).toEqual({
      kind: 'delta',
      change: 59_400_000,
      windowDays: 30,
      from: at('2026-10-10'),
      to: at('2026-11-08'),
    });
  });
  it('is "as of" with one reading and null with none', () => {
    expect(powerDelta([power('2026-11-08', 5)], 7)).toEqual({
      kind: 'asOf',
      at: at('2026-11-08'),
      value: 5,
    });
    expect(powerDelta([], 7)).toBeNull();
  });
  it('skips kill-board rows, which carry no power', () => {
    expect(powerDelta([kills('2026-11-01', 9), power('2026-11-08', 5)], 7)).toEqual({
      kind: 'asOf',
      at: at('2026-11-08'),
      value: 5,
    });
  });
});

describe('killsDelta', () => {
  it('reads only the kill board', () => {
    const profile: HistoryRow = {
      captured_at: at('2026-11-07'),
      power: 1,
      kills: 999,
      source_command: 'get.user.info.multi',
    };
    expect(killsDelta([kills('2026-11-02', 100), profile, kills('2026-11-08', 130)], 7)).toEqual({
      kind: 'delta',
      change: 30,
      windowDays: 7,
      from: at('2026-11-02'),
      to: at('2026-11-08'),
    });
  });
  it('is null when no kill board placed the player in the window', () => {
    expect(killsDelta([power('2026-11-08', 5)], 7)).toBeNull();
  });
});
