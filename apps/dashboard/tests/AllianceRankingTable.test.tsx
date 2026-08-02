import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  type AllianceRankingRow,
  AllianceRankingTable,
} from '../src/features/rankings/AllianceRankingTable';
import { renderWithQuery } from './renderWithQuery';

const NOW = new Date('2026-07-28T12:00:00Z');

function row(overrides: Partial<AllianceRankingRow>): AllianceRankingRow {
  return {
    snapshot_id: crypto.randomUUID(),
    alliance_id: crypto.randomUUID(),
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

test('shows the rows it is given, in the order it is given them', () => {
  // Deduping moved into the alliance_latest view (0035). It used to happen
  // here AND re-sort by power on the way out, which silently overrode
  // whatever order the query asked for — that is how the sort header ended
  // up describing an order nothing was in.
  const rows = [
    row({ external_id: 'a', name: 'First', power: 300 }),
    row({ external_id: 'b', name: 'Second', power: 200 }),
  ];
  renderWithQuery(<AllianceRankingTable rows={rows} now={NOW} />);
  const names = screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent ?? '');
  expect(names[0]).toContain('First');
  expect(names[1]).toContain('Second');
});

test('renders alliances with freshness and unknown values', () => {
  renderWithQuery(
    <AllianceRankingTable
      rows={[
        row({ external_id: 'a' }),
        row({ external_id: 'b'.repeat(32), name: null, power: null, code: null }),
      ]}
      now={NOW}
    />,
  );
  expect(screen.getByText('[CBFW] Tempest')).toBeDefined();
  expect(screen.getAllByText('5m ago')).toHaveLength(2);
  // An alliance with no name falls back to its id, and unknown power
  // renders as unknown rather than zero.
  expect(screen.getByText('bbbbbbbb')).toBeDefined();
  expect(screen.getByText('—')).toBeDefined();
});

test('empty rankings state themselves', () => {
  renderWithQuery(<AllianceRankingTable rows={[]} now={NOW} />);
  expect(screen.getByText('No alliance ranking data yet.')).toBeDefined();
});
