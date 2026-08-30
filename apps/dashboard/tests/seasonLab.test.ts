import { expect, test } from 'vitest';
import {
  NO_SEASON_LAB,
  type SeasonLab,
  labAdjustment,
  parseSeasonLab,
  seasonLabApplies,
} from '../src/lib/seasonLab';

const SEASON: SeasonLab = {
  enabled: true,
  startsAt: '2026-09-10T02:00:00Z',
  endsAt: '2026-11-10T02:00:00Z',
  buildingId: 862000,
  low: 15,
  high: 22,
  penalty: 10,
  bonus: 10,
};

// --- parseSeasonLab -------------------------------------------------------

test('the whole block is read out of the tier setting', () => {
  const parsed = parseSeasonLab({
    minimums: { enabled: true },
    season_lab: {
      enabled: true,
      starts_at: '2026-09-10T02:00:00Z',
      ends_at: '2026-11-10T02:00:00Z',
      building_id: 862000,
      low: 15,
      high: 22,
      penalty: 10,
      bonus: 10,
    },
  });
  expect(parsed).toEqual(SEASON);
});

// A setting saved before 0159 has no season_lab key at all, and every field
// would arrive undefined rather than falling back.
test('a setting saved before the rule existed is no rule', () => {
  expect(parseSeasonLab({ minimums: { enabled: true } })).toEqual(NO_SEASON_LAB);
  expect(parseSeasonLab(null)).toEqual(NO_SEASON_LAB);
  expect(parseSeasonLab('nonsense')).toEqual(NO_SEASON_LAB);
});

// The page where a broken setting would be fixed must still open.
test('unreadable numbers and dates fall back rather than throwing', () => {
  const parsed = parseSeasonLab({
    season_lab: {
      enabled: true,
      starts_at: 'whenever',
      ends_at: null,
      building_id: '862000',
      low: -5,
      high: Number.NaN,
      penalty: 'ten',
    },
  });
  expect(parsed.startsAt).toBeNull();
  expect(parsed.endsAt).toBeNull();
  expect(parsed.buildingId).toBeNull();
  expect(parsed.low).toBe(0);
  expect(parsed.high).toBe(0);
  expect(parsed.penalty).toBe(0);
});

// --- seasonLabApplies -----------------------------------------------------

test('the period start decides, and the window is half-open', () => {
  // Opens before the season: scored the old way even though it ends inside.
  expect(seasonLabApplies(SEASON, new Date('2026-09-01T02:00:00Z'))).toBe(false);
  // Opens exactly on the first day.
  expect(seasonLabApplies(SEASON, new Date('2026-09-10T02:00:00Z'))).toBe(true);
  expect(seasonLabApplies(SEASON, new Date('2026-10-01T02:00:00Z'))).toBe(true);
  // Opens exactly at the end: the first period AFTER the season, not the last
  // one inside it.
  expect(seasonLabApplies(SEASON, new Date('2026-11-10T02:00:00Z'))).toBe(false);
});

test('off between seasons, and off while a date is missing', () => {
  const inside = new Date('2026-10-01T02:00:00Z');
  expect(seasonLabApplies({ ...SEASON, enabled: false }, inside)).toBe(false);
  // A missing start must not read as "since the beginning of time".
  expect(seasonLabApplies({ ...SEASON, startsAt: null }, inside)).toBe(false);
  expect(seasonLabApplies({ ...SEASON, endsAt: null }, inside)).toBe(false);
});

// --- labAdjustment --------------------------------------------------------

test('below the low level costs the penalty, at or above the high level earns the bonus', () => {
  expect(labAdjustment(14, SEASON)).toBe(-10);
  expect(labAdjustment(15, SEASON)).toBe(0);
  expect(labAdjustment(21, SEASON)).toBe(0);
  expect(labAdjustment(22, SEASON)).toBe(10);
  expect(labAdjustment(30, SEASON)).toBe(10);
});

// The rule the building board already states on screen. Without it the
// penalty falls on whoever the collector missed rather than on whoever is
// behind — which on the current grid is most of the alliance.
test('a level nobody has seen is not a low level', () => {
  expect(labAdjustment(null, SEASON)).toBe(0);
});

// Otherwise `level < 0` never fires but `level >= 0` fires for everybody, and
// switching the window on before choosing levels hands out the bonus to all.
test('a threshold of zero is no threshold', () => {
  expect(labAdjustment(0, { ...SEASON, low: 0, high: 0 })).toBe(0);
  expect(labAdjustment(50, { ...SEASON, low: 0, high: 0 })).toBe(0);
});

test('sizes default to zero, so a window switched on early moves nobody', () => {
  const unsized = { ...SEASON, penalty: 0, bonus: 0 };
  expect(labAdjustment(1, unsized)).toBe(-0);
  expect(labAdjustment(99, unsized)).toBe(0);
});
