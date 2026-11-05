import { describe, expect, it } from 'vitest';
import { serverRankOf } from './serverRank';

describe('serverRankOf', () => {
  it('is one more than the players ahead', () => {
    expect(serverRankOf(0, 100)).toEqual({ rank: 1, total: 100 });
    expect(serverRankOf(11, 100)).toEqual({ rank: 12, total: 100 });
  });
  it('has no rank without counts', () => {
    expect(serverRankOf(null, 100)).toBeNull();
    expect(serverRankOf(3, null)).toBeNull();
    expect(serverRankOf(0, 0)).toBeNull();
  });
});
