import { describe, expect, it } from 'vitest';
import { filterMoves, newestMoves, otherAllianceLabel } from './moves';

describe('otherAllianceLabel', () => {
  it('names a catalogued alliance with its tag and server', () => {
    expect(otherAllianceLabel({ other_alliance_tag: 'CLaw', other_server_id: 571 })).toBe(
      '[CLaw] on 571',
    );
  });
  it('keeps the server when the alliance is not catalogued', () => {
    expect(otherAllianceLabel({ other_alliance_tag: null, other_server_id: 571 })).toBe('on 571');
  });
  it('says no alliance when there was none', () => {
    expect(otherAllianceLabel({ other_alliance_tag: null, other_server_id: null })).toBe(
      'no alliance',
    );
  });
});

describe('filterMoves', () => {
  const rows = [{ direction: 'in' }, { direction: 'out' }, { direction: 'relocated' }];
  it('keeps one direction', () => {
    expect(filterMoves(rows, 'out')).toEqual([{ direction: 'out' }]);
  });
  it('keeps everything for all', () => {
    expect(filterMoves(rows, 'all')).toHaveLength(3);
  });
});

describe('newestMoves', () => {
  const rows = [
    { observed_at: '2026-11-01T00:00:00Z' },
    { observed_at: '2026-11-03T00:00:00Z' },
    { observed_at: '2026-11-02T00:00:00Z' },
  ];
  it('orders newest first and takes the limit', () => {
    expect(newestMoves(rows, 2).map((r) => r.observed_at)).toEqual([
      '2026-11-03T00:00:00Z',
      '2026-11-02T00:00:00Z',
    ]);
  });
  it('does not reorder the input', () => {
    newestMoves(rows, 1);
    expect(rows[0]?.observed_at).toBe('2026-11-01T00:00:00Z');
  });
});
