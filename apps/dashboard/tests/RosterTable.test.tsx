// FR-UI-007/008: freshness is visible, and unknown values render as
// unknown — never as zero.
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { type RosterRow, RosterTable } from '../src/features/roster/RosterTable';

const NOW = new Date('2026-07-28T12:00:00Z');

const rows: RosterRow[] = [
  {
    player_id: 'p1',
    game_uid: 58000001,
    current_name: 'SyntheticPlayer01',
    hq_level: 21,
    power: 200_000_000,
    kills: 1_000_000,
    month_card_expires_at: '2026-08-25T02:00:00Z',
    daily_donation_score: 5860,
    alliance_battle_score: 42_000,
    last_seen_at: '2026-07-28T11:55:00Z',
  },
  {
    player_id: 'p2',
    game_uid: 58000002,
    current_name: null,
    hq_level: null,
    power: null,
    kills: null,
    month_card_expires_at: null,
    daily_donation_score: null,
    alliance_battle_score: null,
    last_seen_at: null,
  },
];

test('renders roster with freshness badge', () => {
  render(<RosterTable rows={rows} now={NOW} />);
  expect(screen.getByText('SyntheticPlayer01')).toBeDefined();
  expect(screen.getByText('5분 전')).toBeDefined();
});

test('missing values render as unknown, not zero', () => {
  render(<RosterTable rows={rows} now={NOW} />);
  expect(screen.getByText('UID 58000002')).toBeDefined();
  expect(screen.getByText('데이터 없음')).toBeDefined();
  expect(screen.queryByText('0')).toBeNull();
});

test('empty roster states itself instead of a bare table', () => {
  render(<RosterTable rows={[]} now={NOW} />);
  expect(screen.getByText('로스터 데이터가 아직 없습니다.')).toBeDefined();
});

test('contribution scores appear, and unknown stays a dash', () => {
  render(<RosterTable rows={rows} now={NOW} />);
  expect(screen.getByText('5,860')).toBeDefined();
  expect(screen.getByText('42,000')).toBeDefined();
  // The second player has no observed contribution: dashes, not zeros.
  expect(screen.queryByText('0')).toBeNull();
});

test('monthly pass shows remaining days, and unknown is not expired', () => {
  render(<RosterTable rows={rows} now={NOW} />);
  // 2026-08-25 is 27 days after NOW.
  expect(screen.getByText('D-27')).toBeDefined();
  // The player we have never seen a pass for renders as unknown, not 만료.
  expect(screen.queryByText('만료')).toBeNull();
});
