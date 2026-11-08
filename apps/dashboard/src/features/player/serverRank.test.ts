import { describe, expect, it } from 'vitest';
import { serverRankFacts } from './serverRank';

describe('serverRankFacts', () => {
  it('turns neighbour powers into a gap and a lead', () => {
    expect(
      serverRankFacts({
        rank: 2,
        total: 4,
        power: 400,
        next_above_power: 500,
        next_below_power: 100,
      }),
    ).toEqual({ rank: 2, total: 4, gapToAbove: 100, leadOverBelow: 300 });
  });

  it('has no gap at the top and no lead at the bottom', () => {
    expect(
      serverRankFacts({
        rank: 1,
        total: 4,
        power: 500,
        next_above_power: null,
        next_below_power: 400,
      }),
    ).toEqual({ rank: 1, total: 4, gapToAbove: null, leadOverBelow: 100 });
    expect(
      serverRankFacts({
        rank: 4,
        total: 4,
        power: 100,
        next_above_power: 400,
        next_below_power: null,
      })?.leadOverBelow,
    ).toBeNull();
  });

  it('is null when the RPC returned no row', () => {
    expect(serverRankFacts(null)).toBeNull();
    expect(serverRankFacts(undefined)).toBeNull();
  });
});
