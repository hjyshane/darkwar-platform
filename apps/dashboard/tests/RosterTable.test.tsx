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
    last_seen_at: '2026-07-28T11:55:00Z',
  },
  {
    player_id: 'p2',
    game_uid: 58000002,
    current_name: null,
    hq_level: null,
    power: null,
    kills: null,
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
