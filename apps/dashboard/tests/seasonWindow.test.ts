import { describe, expect, it } from 'vitest';
import { seasonWindow } from '../src/lib/seasons';

const season = (startsAt: string | null, endsAt: string | null) => ({
  id: 4,
  name: 'Season 4',
  startsAt,
  endsAt,
  buildings: [],
});

describe('seasonWindow', () => {
  it('gives whole-second UTC instants, the form the rule stores', () => {
    expect(seasonWindow(season('2026-11-09T02:00:00.000Z', '2027-01-04T02:00:00.000Z'))).toEqual({
      startsAt: '2026-11-09T02:00:00Z',
      endsAt: '2027-01-04T02:00:00Z',
    });
  });

  it('leaves the end empty while the season has none', () => {
    expect(seasonWindow(season('2026-11-09T02:00:00.000Z', null))?.endsAt).toBe('');
  });

  it('has no window for a season with no start, or none at all', () => {
    expect(seasonWindow(season(null, null))).toBeNull();
    expect(seasonWindow(null)).toBeNull();
  });
});
