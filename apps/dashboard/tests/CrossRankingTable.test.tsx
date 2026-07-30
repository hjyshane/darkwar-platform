import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  type CrossRankingRow,
  CrossRankingTable,
} from '../src/features/crossRankings/CrossRankingTable';
import { latestBatch } from '../src/features/crossRankings/latestBatch';

function row(overrides: Partial<CrossRankingRow>): CrossRankingRow {
  return {
    snapshot_id: crypto.randomUUID(),
    rank: 1,
    name: 'Ranked001',
    game_uid: 9000000001000578,
    server_id: 578,
    power: 66_500_000,
    kills: 11_430_164,
    captured_at: '2026-07-30T18:38:00Z',
    ...overrides,
  };
}

describe('latestBatch', () => {
  it('keeps only the newest capture of the board', () => {
    const rows = [
      row({ name: 'old', captured_at: '2026-07-29T10:00:00Z' }),
      row({ name: 'new1', captured_at: '2026-07-30T18:38:00Z' }),
      row({ name: 'new2', captured_at: '2026-07-30T18:38:00Z' }),
    ];
    expect(latestBatch(rows).map((r) => r.name)).toEqual(['new1', 'new2']);
  });

  it('passes an empty board through', () => {
    expect(latestBatch([])).toEqual([]);
  });
});

describe('CrossRankingTable', () => {
  it('shows the metric the board is ranked by', () => {
    render(<CrossRankingTable rows={[row({})]} metric="kills" />);
    expect(screen.getByRole('columnheader', { name: '킬' })).toBeDefined();
    expect(screen.getByText('11,430,164')).toBeDefined();
  });

  it('renders unknown as a dash, never zero (FR-UI-008)', () => {
    render(<CrossRankingTable rows={[row({ power: null })]} metric="power" />);
    expect(screen.getByText('—')).toBeDefined();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('falls back to the uid when the name is unknown', () => {
    render(<CrossRankingTable rows={[row({ name: null })]} metric="power" />);
    expect(screen.getByText('UID 9000000001000578')).toBeDefined();
  });
});
