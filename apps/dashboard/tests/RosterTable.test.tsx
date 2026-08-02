// FR-UI-007/008: freshness is visible, and unknown values render as
// unknown — never as zero. The monthly pass is deliberately ABSENT from
// this table: it lives on its own unlinked page (see route.ts), and a
// test below pins that it does not creep back in.
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { type RosterRow, RosterTable } from '../src/features/roster/RosterTable';
import { renderWithQuery } from './renderWithQuery';

const NOW = new Date('2026-07-28T12:00:00Z');

const rows: RosterRow[] = [
  {
    player_id: 'p1',
    game_uid: 58000001,
    current_name: 'SyntheticPlayer01',
    hq_level: 21,
    power: 200_000_000,
    kills: 1_000_000,
    daily_donation_score: 14_500,
    weekly_donation_score: 86_440,
    duel_daily_score: 5_658_634,
    duel_weekly_score: 26_865_932,
    duel_round_score: 103_501_541,
    online_state: 'offline',
    last_online_at: '2026-07-28T09:00:00Z',
    last_seen_at: '2026-07-28T11:55:00Z',
    assigned_rank: 'R4',
    computed_rank: 'R3',
    rank_score: 88.4,
    growth_1d: 2.44,
    growth_7d: -1.06,
    growth_1d_at: '2026-07-27T09:00:00Z',
    growth_7d_at: '2026-07-21T09:00:00Z',
  },
  {
    player_id: 'p2',
    game_uid: 58000002,
    current_name: null,
    hq_level: null,
    power: null,
    kills: null,
    daily_donation_score: null,
    weekly_donation_score: null,
    duel_daily_score: null,
    duel_weekly_score: null,
    duel_round_score: null,
    assigned_rank: null,
    computed_rank: null,
    rank_score: null,
    growth_1d: null,
    growth_7d: null,
    growth_1d_at: null,
    growth_7d_at: null,
    online_state: null,
    last_online_at: null,
    last_seen_at: null,
  },
];

test('renders roster with freshness badge', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  expect(screen.getByText('SyntheticPlayer01')).toBeDefined();
  expect(screen.getByText('5m ago')).toBeDefined();
});

test("last online is the player's own clock, not the collector's", () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  // Two facts about the same row: last online 3h ago, last looked at 5m ago.
  // Before 0024 the second was labelled as if it were the first.
  expect(screen.getByText('3h ago')).toBeDefined();
  expect(screen.getByText('5m ago')).toBeDefined();
});

test('presence we were never shown reads as unknown, not offline', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  // A redacted roster, a non-member, or a logged-out reader all land here.
  expect(screen.queryByText('Offline')).toBeNull();
});

test('missing values render as unknown, not zero', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  expect(screen.getByText('UID 58000002')).toBeDefined();
  expect(screen.getByText('No data')).toBeDefined();
  expect(screen.queryByText('0')).toBeNull();
});

test('empty roster states itself instead of a bare table', () => {
  renderWithQuery(<RosterTable rows={[]} now={NOW} />);
  expect(screen.getByText('No member data yet.')).toBeDefined();
});

test('contribution scores appear, and unknown stays a dash', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  // Donation's two boards, both from the 2026-08-01 capture's top entry: the
  // weekly figure is its own reading, which is why it is not 14,500 × 7.
  expect(screen.getByText('14,500')).toBeDefined();
  expect(screen.getByText('86,440')).toBeDefined();
  // The duel's three boards each get their own figure. They shared one column
  // until 0028, where the number shown depended on insert order.
  expect(screen.getByText('5,658,634')).toBeDefined();
  expect(screen.getByText('26,865,932')).toBeDefined();
  expect(screen.getByText('103,501,541')).toBeDefined();
  // The second player has no observed contribution: dashes, not zeros.
  expect(screen.queryByText('0')).toBeNull();
});

test('the monthly pass does not appear in the roster', () => {
  // Admin-only finance data has its own page, reached only by typing its
  // address; the shared dashboard must not even name it.
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  expect(screen.queryByText('Monthly Card')).toBeNull();
});

test('growth carries its sign and its direction, and unknown carries neither', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);

  // The sign is in the text, so the colour is emphasis rather than the
  // message — a reader who cannot separate the two hues still reads these.
  const up = screen.getByText('+2.4%');
  const down = screen.getByText('-1.1%');
  expect(up.className).toContain('growth-up');
  expect(down.className).toContain('growth-down');

  // The second member has no earlier snapshot. That is not 0% — a member
  // whose power has not been measured twice has an unknown change, and
  // FR-UI-008 says an unknown never wears a nought.
  expect(screen.queryByText('0.0%')).toBeNull();
  expect(
    document.querySelectorAll('td[title="No earlier snapshot to compare against"]').length,
  ).toBe(2);
});
