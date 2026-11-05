import { describe, expect, it } from 'vitest';
import { recentDepartures, strongest } from './overview';

const m = (gameUid: number, power: number | null) => ({
  playerId: null,
  name: `m${gameUid}`,
  gameUid,
  power,
  hqLevel: 30,
});

describe('strongest', () => {
  it('orders by power and takes the limit', () => {
    expect(strongest([m(1, 10), m(2, 30), m(3, 20)], 2).map((x) => x.gameUid)).toEqual([2, 3]);
  });
  it('leaves out members whose power was never read', () => {
    expect(strongest([m(1, null), m(2, 5)], 5).map((x) => x.gameUid)).toEqual([2]);
  });
  it('breaks ties by uid so the order does not flicker', () => {
    expect(strongest([m(9, 10), m(4, 10)], 2).map((x) => x.gameUid)).toEqual([4, 9]);
  });
});

describe('recentDepartures', () => {
  const NOW = new Date('2026-11-05T00:00:00Z');
  const row = (at: string) => ({ last_seen_in_alliance_at: at });
  it('keeps those inside the window, edge included', () => {
    const rows = [
      row('2026-10-29T00:00:00Z'),
      row('2026-10-28T23:59:59Z'),
      row('2026-11-04T00:00:00Z'),
    ];
    expect(recentDepartures(rows, NOW, 7)).toHaveLength(2);
  });
});
