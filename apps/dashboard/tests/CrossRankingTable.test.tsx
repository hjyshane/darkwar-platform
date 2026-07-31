import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CrossRankingTable } from '../src/features/crossRankings/CrossRankingTable';
import { BOARDS, type BoardRow, boardById } from '../src/features/crossRankings/boards';
import { latestBatch } from '../src/features/crossRankings/latestBatch';

function row(overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    id: crypto.randomUUID(),
    rank: 1,
    name: 'Ranked001',
    game_uid: 9000000001000578,
    server_id: 578,
    value: 109_781_050,
    unit_id: null,
    captured_at: '2026-07-30T05:37:10Z',
    ...overrides,
  };
}

describe('latestBatch', () => {
  it('keeps only the newest capture of the board', () => {
    const rows = [
      row({ name: 'old', captured_at: '2026-07-29T10:00:00Z' }),
      row({ name: 'new1', captured_at: '2026-07-30T05:37:10Z' }),
      row({ name: 'new2', captured_at: '2026-07-30T05:37:10Z' }),
    ];
    expect(latestBatch(rows).map((r) => r.name)).toEqual(['new1', 'new2']);
  });

  it('passes an empty board through', () => {
    expect(latestBatch([])).toEqual([]);
  });
});

describe('boards', () => {
  it('offers all six, each with its own value label', () => {
    // Six distinct ids and six distinct query keys; a duplicate would make
    // two boards share a react-query cache entry and show each other's data.
    expect(new Set(BOARDS.map((b) => b.id)).size).toBe(6);
    expect(BOARDS.map((b) => b.id)).toEqual([
      'power',
      'kills',
      'hero_power_total',
      'hero_power_best',
      'pet_power_total',
      'pet_power_best',
    ]);
  });

  it('names a unit only on the boards that rank one', () => {
    // The totals aggregate across every hero/pet, so there is no single
    // unit to name — a column of dashes would imply otherwise.
    expect(boardById('hero_power_best').unitLabel).toBe('Hero ID');
    expect(boardById('pet_power_best').unitLabel).toBe('Pet ID');
    expect(boardById('hero_power_total').unitLabel).toBeNull();
    expect(boardById('power').unitLabel).toBeNull();
  });
});

describe('CrossRankingTable', () => {
  it('labels the ranked number per board', () => {
    render(<CrossRankingTable rows={[row()]} board={boardById('hero_power_total')} />);
    expect(screen.getByRole('columnheader', { name: 'Hero Power' })).toBeDefined();
    expect(screen.getByText('109,781,050')).toBeDefined();
  });

  it('shows the unit column only on a best board', () => {
    render(
      <CrossRankingTable rows={[row({ unit_id: 40002 })]} board={boardById('hero_power_best')} />,
    );
    expect(screen.getByRole('columnheader', { name: 'Hero ID' })).toBeDefined();
    expect(screen.getByText('40002')).toBeDefined();
  });

  it('omits the unit column on a total board', () => {
    render(<CrossRankingTable rows={[row()]} board={boardById('pet_power_total')} />);
    expect(screen.queryByRole('columnheader', { name: 'Pet ID' })).toBeNull();
  });

  it('renders unknown as a dash, never zero (FR-UI-008)', () => {
    render(<CrossRankingTable rows={[row({ value: null })]} board={boardById('power')} />);
    expect(screen.getByText('—')).toBeDefined();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('falls back to the uid when the name is unknown', () => {
    render(<CrossRankingTable rows={[row({ name: null })]} board={boardById('power')} />);
    expect(screen.getByText('UID 9000000001000578')).toBeDefined();
  });
});
