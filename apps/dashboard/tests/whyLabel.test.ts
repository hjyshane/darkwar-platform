import { expect, test } from 'vitest';
import { type RankRow, whyLabel } from '../src/features/admin/RankReportSetting';

/** A scored member with nothing special about them. */
function row(over: Partial<RankRow> = {}): RankRow {
  return {
    player_id: 'p',
    name: 'Somebody',
    donation_total: 1000,
    duel_total: 1000,
    power_growth: 1,
    activity_score: 50,
    offline_hours: 0,
    tier: 'R2',
    tier_reason: 'score',
    below_minimum: false,
    minimum_missed: null,
    lab_level: null,
    lab_adjustment: 0,
    computed_at: '2026-08-30T21:00:00Z',
    ...over,
  };
}

// The bug this function exists for. Both of these produce a BLANK tier, and
// both used to print "score" beside an empty rank and an empty figure —
// fourteen of ninety-six rows on the 2026-08-17 period.
test('an officer is not described as scored', () => {
  const officer = row({
    tier: null,
    activity_score: null,
    tier_reason: 'measured but not ranked: R4 and above',
  });
  expect(whyLabel(officer)).toBe('officer — measured, not ranked');
});

test('a newcomer is not described as scored', () => {
  const newcomer = row({
    tier: null,
    activity_score: null,
    tier_reason: 'not measured: joined within the last two weeks',
  });
  expect(whyLabel(newcomer)).toBe('joined too recently to score');
});

test('a member nothing was captured for is not described as scored', () => {
  const unseen = row({
    tier: null,
    activity_score: null,
    tier_reason: 'nothing was captured for this member in this period',
  });
  expect(whyLabel(unseen)).toBe('nothing captured this period');
});

test('offline says how long, because away is not the same as idle', () => {
  expect(whyLabel(row({ tier_reason: 'offline', offline_hours: 364.6 }))).toBe('offline 365h');
});

test('a missed minimum outranks the season building', () => {
  const both = row({
    below_minimum: true,
    minimum_missed: 'donation',
    lab_adjustment: -10,
    tier_reason: 'below minimum: donation',
  });
  expect(whyLabel(both)).toBe('under weekly donation');
});

test('the season building says which way it moved the score', () => {
  expect(whyLabel(row({ lab_adjustment: -10 }))).toBe('score, season building -10');
  expect(whyLabel(row({ lab_adjustment: 10 }))).toBe('score, season building +10');
});

test('an ordinary scored member just says score', () => {
  expect(whyLabel(row())).toBe('score');
});

// Prefix matching, so rewording the sentence in a later migration shows the
// migration's own text rather than silently falling back to "score" — which is
// the failure this whole function was written to end.
test('an unrecognised reason shows itself rather than claiming a score', () => {
  expect(whyLabel(row({ tier_reason: 'some rule invented in 0200' }))).toBe(
    'some rule invented in 0200',
  );
  expect(whyLabel(row({ tier_reason: null }))).toBe('score');
});
