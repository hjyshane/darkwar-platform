import { describe, expect, it } from 'vitest';
import {
  FALLBACK_SEASONS,
  type Season,
  currentBuildings,
  currentSeason,
  fromUtcInput,
  pastSeason,
  toUtcInput,
} from './seasons';

const season = (id: number, startsAt: string | null): Season => ({
  id,
  name: `Season ${id}`,
  startsAt,
  endsAt: null,
  buildings: [{ id: id * 1000, name: `B${id}` }],
});

const NOW = new Date('2026-10-07T12:00:00Z');

describe('currentSeason', () => {
  it('is the latest season that has started', () => {
    const list = [
      season(2, null),
      season(3, '2026-08-17T02:00:00Z'),
      season(4, '2026-09-28T02:00:00Z'),
    ];
    expect(currentSeason(list, NOW)?.id).toBe(4);
  });
  it('ignores a season that starts in the future', () => {
    const list = [season(3, '2026-08-17T02:00:00Z'), season(4, '2026-12-01T02:00:00Z')];
    expect(currentSeason(list, NOW)?.id).toBe(3);
  });
  it('never treats an unknown start as current', () => {
    expect(currentSeason([season(2, null)], NOW)).toBeNull();
  });
  it('does not depend on the order of the list', () => {
    const list = [season(4, '2026-09-28T02:00:00Z'), season(3, '2026-08-17T02:00:00Z')];
    expect(currentSeason(list, NOW)?.id).toBe(4);
  });
});

describe('pastSeason', () => {
  it('is the highest-numbered season below the current one', () => {
    const list = [
      season(2, null),
      season(3, '2026-08-17T02:00:00Z'),
      season(4, '2026-09-28T02:00:00Z'),
    ];
    expect(pastSeason(list, NOW)?.id).toBe(3);
  });
  it('is none while only one season has started and nothing is below it', () => {
    expect(pastSeason([season(3, '2026-08-17T02:00:00Z')], NOW)).toBeNull();
  });
  it('falls back to Season 2 under Season 3', () => {
    expect(pastSeason(FALLBACK_SEASONS, NOW)?.id).toBe(2);
  });
});

describe('currentBuildings', () => {
  it('reads the current season, and Season 3 when nothing is known', () => {
    expect(currentBuildings([season(4, '2026-09-28T02:00:00Z')], NOW)[0]?.name).toBe('B4');
    expect(currentBuildings(undefined, NOW)).toHaveLength(11);
    expect(currentBuildings([], NOW)).toHaveLength(11);
  });
});

describe('UTC date boxes', () => {
  it('round-trips an instant without the browser zone', () => {
    const text = toUtcInput('2026-08-17T02:00:00+00:00');
    expect(text).toBe('2026-08-17T02:00');
    expect(fromUtcInput(text)).toBe('2026-08-17T02:00:00.000Z');
  });
  it('an empty box is no date, and nonsense is refused', () => {
    expect(toUtcInput(null)).toBe('');
    expect(fromUtcInput('')).toBeNull();
    expect(fromUtcInput('not a date')).toBeUndefined();
  });
});
