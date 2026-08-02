import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CrossRankingTable } from '../src/features/crossRankings/CrossRankingTable';
import { BOARDS, type BoardRow, boardById } from '../src/features/crossRankings/boards';
import { latestBatch } from '../src/features/crossRankings/latestBatch';
// The table resolves a unit id into a hero or pet name now, so it reads two
// catalogues and needs a query client — no catalogue loads here, which is
// the case that has to keep printing the id.
import { renderWithQuery } from './renderWithQuery';

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
    renderWithQuery(<CrossRankingTable rows={[row()]} board={boardById('hero_power_total')} />);
    expect(screen.getByRole('columnheader', { name: 'Hero Power' })).toBeDefined();
    expect(screen.getByText('109,781,050')).toBeDefined();
  });

  it('shows the unit column only on a best board', () => {
    renderWithQuery(
      <CrossRankingTable rows={[row({ unit_id: 40002 })]} board={boardById('hero_power_best')} />,
    );
    expect(screen.getByRole('columnheader', { name: 'Hero ID' })).toBeDefined();
    expect(screen.getByText('40002')).toBeDefined();
  });

  it('omits the unit column on a total board', () => {
    renderWithQuery(<CrossRankingTable rows={[row()]} board={boardById('pet_power_total')} />);
    expect(screen.queryByRole('columnheader', { name: 'Pet ID' })).toBeNull();
  });

  it('renders unknown as a dash, never zero (FR-UI-008)', () => {
    renderWithQuery(<CrossRankingTable rows={[row({ value: null })]} board={boardById('power')} />);
    expect(screen.getByText('—')).toBeDefined();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('names the unit from its own catalogue, and prints the id without one', () => {
    // No catalogue is loaded in a test, so both boards fall back to the id —
    // which is the assertion worth making, because it is what a reader sees
    // for any hero or pet nobody has named yet.
    renderWithQuery(
      <CrossRankingTable rows={[row({ unit_id: 106 })]} board={boardById('pet_power_best')} />,
    );
    expect(screen.getByText('106')).toBeDefined();
    // The id stays reachable even once a name replaces it.
    expect(screen.getByTitle('#106')).toBeDefined();
  });

  it('asks the right catalogue per board — the same column, two vocabularies', () => {
    expect(boardById('hero_power_best').unitKind).toBe('hero');
    expect(boardById('pet_power_best').unitKind).toBe('pet');
    // A board that ranks no single unit names none either.
    expect(boardById('power').unitKind).toBeNull();
    expect(boardById('hero_power_total').unitKind).toBeNull();
  });

  it('falls back to the uid when the name is unknown', () => {
    renderWithQuery(<CrossRankingTable rows={[row({ name: null })]} board={boardById('power')} />);
    expect(screen.getByText('UID 9000000001000578')).toBeDefined();
  });
});
