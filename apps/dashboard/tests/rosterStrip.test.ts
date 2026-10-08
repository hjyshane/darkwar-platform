import { describe, expect, it } from 'vitest';
import type { RosterRow } from '../src/features/roster/RosterTable';
import { rosterStrip } from '../src/features/roster/strip';

const row = (over: Partial<RosterRow> = {}): RosterRow =>
  ({
    power: null,
    growth_7d: null,
    below_minimum: null,
    online_state: null,
    ...over,
  }) as unknown as RosterRow;

const byLabel = (rows: RosterRow[], label: string) =>
  rosterStrip(rows).find((cell) => cell.label === label);

describe('rosterStrip', () => {
  it('counts members and sums power, saying how many were counted when some are missing', () => {
    const rows = [row({ power: 1_500_000 }), row({ power: 2_500_000 }), row()];

    expect(byLabel(rows, 'Members')?.value).toBe('3');
    expect(byLabel(rows, 'Power')).toMatchObject({ value: '4M', note: '2 of 3 counted' });
  });

  it('has no note when every member has a figure', () => {
    expect(byLabel([row({ power: 10 }), row({ power: 20 })], 'Power')?.note).toBeUndefined();
  });

  it('is a dash, never zero, when nobody has a figure', () => {
    expect(byLabel([row(), row()], 'Power')?.value).toBeNull();
    expect(byLabel([row(), row()], 'Typical growth, 7 days')?.value).toBeNull();
  });

  it('takes the median of the members percentages, so one account cannot drag it', () => {
    // Growth is already a percentage per member; summing them would be meaningless.
    const rows = [row({ growth_7d: 1 }), row({ growth_7d: 2 }), row({ growth_7d: 900 })];

    expect(byLabel(rows, 'Typical growth, 7 days')).toMatchObject({
      value: '+2.0%',
      note: 'median member',
      tone: 'up',
    });
  });

  it('averages the middle two for an even count, and marks a fall and no change', () => {
    expect(
      byLabel([row({ growth_7d: 1 }), row({ growth_7d: 2 })], 'Typical growth, 7 days')?.value,
    ).toBe('+1.5%');
    expect(byLabel([row({ growth_7d: -3 })], 'Typical growth, 7 days')).toMatchObject({
      value: '−3.0%',
      tone: 'down',
    });
    expect(byLabel([row({ growth_7d: 0 })], 'Typical growth, 7 days')).toMatchObject({
      value: '0.0%',
      tone: 'flat',
    });
  });

  it('says how many it could use when some members have no earlier snapshot', () => {
    const rows = [row({ growth_7d: 4 }), row()];

    expect(byLabel(rows, 'Typical growth, 7 days')?.note).toBe('median of 1 of 2');
  });

  it('shows the minimum and online cells only when there is something to say', () => {
    expect(rosterStrip([row()]).map((cell) => cell.label)).toEqual([
      'Members',
      'Power',
      'Typical growth, 7 days',
    ]);

    const rows = [
      row({ below_minimum: true, online_state: 'online' }),
      row({ below_minimum: false, online_state: 'offline' }),
    ];
    expect(byLabel(rows, 'Under the minimum')?.value).toBe('1');
    expect(byLabel(rows, 'Online now')?.value).toBe('1');
  });
});
