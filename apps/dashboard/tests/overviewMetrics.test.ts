import { expect, test } from 'vitest';
import {
  DEFAULT_METRICS,
  METRIC_CATALOGUE,
  type MetricId,
  resolveMetrics,
  specFor,
} from '../src/lib/overviewMetrics';

test('a saved choice is kept in the order it was saved', () => {
  const chosen: MetricId[] = ['duel_round', 'members', 'total_power'];
  expect(resolveMetrics(chosen)).toEqual(chosen);
});

test('a metric this build does not know is dropped, not rendered blank', () => {
  // A setting written by another build, or by hand. An empty tile is worse
  // than a missing one: nothing on screen distinguishes "no longer computed"
  // from "the value is zero".
  expect(resolveMetrics(['members', 'moon_phase', 'kills'])).toEqual(['members', 'kills']);
});

test('duplicates collapse', () => {
  // The picker cannot produce them; a hand-edited setting can, and two
  // identical tiles look like a bug in the page rather than in the data.
  expect(resolveMetrics(['members', 'members', 'kills'])).toEqual(['members', 'kills']);
});

test('an unusable setting falls back rather than blanking the screen', () => {
  for (const bad of [null, undefined, [], {}, 'members', ['nope'], [1, 2, 3]]) {
    expect(resolveMetrics(bad)).toEqual([...DEFAULT_METRICS]);
  }
});

test('the default is what the overview shipped with', () => {
  // An install that never opens the settings page must see no change.
  expect([...DEFAULT_METRICS]).toEqual([
    'total_power',
    'members',
    'online',
    'weekly_donation',
    'duel_round',
  ]);
});

test('every default is in the catalogue', () => {
  for (const id of DEFAULT_METRICS) {
    expect(METRIC_CATALOGUE.some((metric) => metric.id === id)).toBe(true);
  }
});

test('the catalogue has no duplicate ids', () => {
  const ids = METRIC_CATALOGUE.map((metric) => metric.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('the two power figures are labelled as different things', () => {
  // One is the game's figure for the whole roster, the other the sum of the
  // members a capture has seen. Offering both without saying which is which
  // is the trap this note exists to avoid.
  expect(specFor('total_power').note).toBe('summed over observed members');
  expect(specFor('alliance_power').note).toBe('as the game reports it');
});

test('every restricted metric is one RLS actually restricts', () => {
  // Contribution (0020) and presence (0024) are member-only; the rest come
  // from world-readable tables. A metric marked restricted that is not would
  // tell a viewer to sign in for something they can already see.
  const restricted = METRIC_CATALOGUE.filter((metric) => metric.restricted).map((m) => m.id);
  expect(restricted.sort()).toEqual(
    [
      'daily_donation',
      'duel_daily',
      'duel_round',
      'duel_weekly',
      'online',
      'weekly_donation',
    ].sort(),
  );
});
