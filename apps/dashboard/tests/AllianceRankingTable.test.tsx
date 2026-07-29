import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  type AllianceRankingRow,
  AllianceRankingTable,
  latestPerAlliance,
} from '../src/features/rankings/AllianceRankingTable';

const NOW = new Date('2026-07-28T12:00:00Z');

function row(overrides: Partial<AllianceRankingRow>): AllianceRankingRow {
  return {
    snapshot_id: crypto.randomUUID(),
    external_id: 'a'.repeat(32),
    server_id: 580,
    rank: 1,
    name: 'Tempest',
    code: 'CBFW',
    power: 15_981_622_619,
    member_count: 93,
    captured_at: '2026-07-28T11:55:00Z',
    ...overrides,
  };
}

test('keeps only the newest observation of each alliance', () => {
  const rows = [
    row({ external_id: 'a', power: 200, captured_at: '2026-07-28T11:00:00Z' }),
    row({ external_id: 'a', power: 100, captured_at: '2026-07-27T11:00:00Z' }),
    row({ external_id: 'b', power: 300 }),
  ];
  const latest = latestPerAlliance(rows);
  expect(latest).toHaveLength(2);
  // Sorted by power, and the stale 100 never wins over the fresh 200.
  expect(latest.map((r) => r.external_id)).toEqual(['b', 'a']);
  expect(latest[1]?.power).toBe(200);
});

test('renders alliances with freshness and unknown values', () => {
  render(
    <AllianceRankingTable
      rows={[
        row({ external_id: 'a' }),
        row({ external_id: 'b'.repeat(32), name: null, power: null, code: null }),
      ]}
      now={NOW}
    />,
  );
  expect(screen.getByText('[CBFW] Tempest')).toBeDefined();
  expect(screen.getAllByText('5분 전')).toHaveLength(2);
  // An alliance with no name falls back to its id, and unknown power
  // renders as unknown rather than zero.
  expect(screen.getByText('bbbbbbbb')).toBeDefined();
  expect(screen.getByText('—')).toBeDefined();
});

test('empty rankings state themselves', () => {
  render(<AllianceRankingTable rows={[]} now={NOW} />);
  expect(screen.getByText('연맹 순위 데이터가 아직 없습니다.')).toBeDefined();
});
