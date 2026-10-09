import { describe, expect, it } from 'vitest';
import { pageKey, sortOf } from '../src/features/crossRankings/remote';
import { remoteStrip } from '../src/features/crossRankings/strip';

describe('sortOf', () => {
  it('uses the primary key when the database can order by it, board order otherwise', () => {
    expect(sortOf([{ key: 'value', direction: 'desc' }])).toEqual({ key: 'value', desc: true });
    expect(sortOf([{ key: 'unit_id', direction: 'desc' }])).toEqual({ key: 'rank', desc: false });
    expect(sortOf([])).toEqual({ key: 'rank', desc: false });
  });
  it('keys the cache by everything the page depends on', () => {
    const base = { metric: 'power', server: null, search: '', sort: [], page: 1 } as const;
    expect(pageKey(base)).not.toEqual(pageKey({ ...base, page: 2 }));
    expect(pageKey(base)).not.toEqual(pageKey({ ...base, server: 586 }));
    expect(pageKey(base)).not.toEqual(pageKey({ ...base, search: 'x' }));
  });
});

describe('remoteStrip', () => {
  it('totals the servers and names the busiest', () => {
    const cells = remoteStrip(
      [
        { id: 580, count: 40, newest: '2026-10-09T10:00:00Z' },
        { id: 586, count: 60, newest: '2026-10-09T11:00:00Z' },
      ],
      undefined,
      'Power',
      new Date('2026-10-09T12:00:00Z'),
    );
    expect(cells[0]).toMatchObject({ label: 'Players', value: '100', note: 'from 2 servers' });
    expect(cells[2]).toMatchObject({ value: 'Server 586', note: '60 players' });
  });
  it('is empty with no players', () => {
    expect(remoteStrip([], undefined, 'Power', new Date())).toEqual([]);
  });
});
