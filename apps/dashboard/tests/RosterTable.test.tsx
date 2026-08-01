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
    daily_donation_score: 5860,
    alliance_battle_score: 42_000,
    online_state: 'offline',
    last_online_at: '2026-07-28T09:00:00Z',
    last_seen_at: '2026-07-28T11:55:00Z',
  },
  {
    player_id: 'p2',
    game_uid: 58000002,
    current_name: null,
    hq_level: null,
    power: null,
    kills: null,
    daily_donation_score: null,
    alliance_battle_score: null,
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
  expect(screen.getByText('5,860')).toBeDefined();
  expect(screen.getByText('42,000')).toBeDefined();
  // The second player has no observed contribution: dashes, not zeros.
  expect(screen.queryByText('0')).toBeNull();
});

test('the monthly pass does not appear in the roster', () => {
  // Admin-only finance data has its own page, reached only by typing its
  // address; the shared dashboard must not even name it.
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  expect(screen.queryByText('Monthly Card')).toBeNull();
});
