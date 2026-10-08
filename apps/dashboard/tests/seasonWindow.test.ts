import { describe, expect, it } from 'vitest';
import { seasonWindow, sinceSeasonStart } from '../src/lib/seasons';

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

describe('sinceSeasonStart', () => {
  const rows = [
    { captured_at: '2026-10-03T13:54:00Z', rank: 1 },
    { captured_at: '2026-11-10T01:00:00Z', rank: 2 },
  ];

  it('drops a capture from before the season began', () => {
    expect(sinceSeasonStart(rows, season('2026-11-09T02:00:00.000Z', null))).toEqual([rows[1]]);
  });

  it('keeps everything while the season has not started or has no known start', () => {
    expect(sinceSeasonStart(rows, season(null, null))).toEqual(rows);
    expect(sinceSeasonStart(rows, null)).toEqual(rows);
  });

  it('keeps a capture taken at the very start', () => {
    expect(
      sinceSeasonStart([rows[1] as (typeof rows)[number]], season('2026-11-10T01:00:00Z', null)),
    ).toHaveLength(1);
  });
});
