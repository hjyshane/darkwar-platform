import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { type MonthCardRow, MonthCardTable } from '../src/features/monthCards/MonthCardTable';
import { routeFromHash } from '../src/lib/route';

const NOW = new Date('2026-07-28T12:00:00Z');

const rows: MonthCardRow[] = [
  {
    player_id: 'p1',
    expires_at: '2026-08-25T02:00:00Z',
    observed_at: '2026-07-28T10:00:00Z',
    players: { current_name: 'Holder', game_uid: 58000001 },
  },
];

test('only the exact address reaches the page', () => {
  expect(routeFromHash('#/month-cards')).toBe('monthCards');
  expect(routeFromHash('')).toBe('dashboard');
  expect(routeFromHash('#/')).toBe('dashboard');
  expect(routeFromHash('#/month-cards/extra')).toBe('dashboard');
});

test('an admin sees holder, status and expiry', () => {
  render(<MonthCardTable rows={rows} now={NOW} />);
  expect(screen.getByText('Holder')).toBeDefined();
  expect(screen.getByText('D-27')).toBeDefined();
  expect(screen.getByText('2026-08-25')).toBeDefined();
});

test('empty is one neutral message, whoever is asking', () => {
  // RLS gives a non-admin zero rows; an admin before any capture also has
  // zero. The page must not distinguish the two — confirming "there is
  // data you cannot see" would leak by implication.
  render(<MonthCardTable rows={[]} now={NOW} />);
  expect(screen.getByText('표시할 데이터가 없습니다.')).toBeDefined();
});
