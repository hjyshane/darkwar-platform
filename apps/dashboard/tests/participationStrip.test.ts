import { describe, expect, it } from 'vitest';
import type { ParticipationRow } from '../src/features/participation/data';
import { participationStrip } from '../src/features/participation/strip';

const row = (over: Partial<ParticipationRow> = {}): ParticipationRow =>
  ({
    duel_days_read: 6,
    duel_weeks_read: 1,
    donation_days_read: 7,
    donation_weeks_read: 1,
    duel_days_over: null,
    donation_days_over: null,
    ...over,
  }) as unknown as ParticipationRow;

const cell = (
  rows: ParticipationRow[],
  bars: { duel: number | null; donation: number | null },
  label: string,
) => participationStrip(rows, bars).find((entry) => entry.label === label);

const NO_BARS = { duel: null, donation: null };

describe('participationStrip', () => {
  it('is empty with nobody on the roster', () => {
    expect(participationStrip([], NO_BARS)).toEqual([]);
  });

  it('counts members and says how many days and weeks each board was read', () => {
    const rows = [row(), row()];

    expect(cell(rows, NO_BARS, 'Members')?.value).toBe('2');
    expect(cell(rows, NO_BARS, 'Duel board read')).toMatchObject({
      value: '6 days',
      note: '1 week of weekly totals',
    });
    expect(cell(rows, NO_BARS, 'Donation board read')?.value).toBe('7 days');
  });

  it('writes a single day in the singular', () => {
    expect(cell([row({ duel_days_read: 1 })], NO_BARS, 'Duel board read')?.value).toBe('1 day');
  });

  it('has no bar cells while no bar is set', () => {
    expect(participationStrip([row()], NO_BARS).map((entry) => entry.label)).toEqual([
      'Members',
      'Duel board read',
      'Donation board read',
    ]);
  });

  it('counts who reached a bar on at least one day, and names the bar', () => {
    const rows = [
      row({ duel_days_over: 3, donation_days_over: 0 }),
      row({ duel_days_over: 0, donation_days_over: 0 }),
      row({ duel_days_over: 1, donation_days_over: 5 }),
    ];
    const bars = { duel: 10_000, donation: 500_000 };

    expect(cell(rows, bars, 'Reached the duel bar')).toMatchObject({
      value: '2 of 3',
      note: '10,000 or more on a day',
    });
    expect(cell(rows, bars, 'Reached the donation bar')).toMatchObject({
      value: '1 of 3',
      note: '500,000 or more on a day',
    });
  });

  it('does not count a member the bar could not be judged for', () => {
    expect(
      cell(
        [row({ duel_days_over: null })],
        { duel: 10_000, donation: null },
        'Reached the duel bar',
      )?.value,
    ).toBe('0 of 1');
  });
});
