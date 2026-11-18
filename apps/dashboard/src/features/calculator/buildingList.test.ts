import { describe, expect, it } from 'vitest';
import type { Subject } from '../planner/data';
import { buildingsForCalculator, fallbackSeason, isOffered } from './buildingList';
import { groupBySeason } from './seasons';

const b = (
  id: string,
  name: string,
  maxLevel: number,
  gameSeason: number | null = null,
): Subject => ({
  subject: id,
  name,
  nameKo: null,
  maxLevel,
  category: null,
  gameSeason,
});

// Rows as production returned them on 2026-11-18: every game_season null.
const ROWS = [
  b('400000', 'Watchtower', 81),
  b('401000', 'Arena', 1),
  b('409000', 'Bank', 200),
  b('436000', 'Road', 1),
  b('449000', '#449000', 3),
  b('500000', 'Bed', 20),
  b('534000', 'Generator', 40),
  b('705000', 'Crystal Factory II', 4),
  b('709000', 'Crystal Factory I', 4),
  b('727000', '#727000', 200),
  b('744000', 'Statue of Carnage I', 50),
  b('764000', 'Obelisk', 30),
  b('774000', 'Mart', 81),
  b('797000', 'Military Center', 81),
  b('818000', 'Truck', 1),
  b('851000', 'Altar I', 30),
  b('862000', 'Thermal Lab', 35),
  b('868000', 'Mineral Factory I', 30),
  b('893000', 'Mart', 81),
  b('1001000', 'Holy Altar I', 30),
  b('1008000', 'Gathering Hall', 50),
];

describe('the calculator building list', () => {
  const list = buildingsForCalculator(ROWS);
  const ordinary = list.filter((s) => s.gameSeason === null).map((s) => s.name);

  it('keeps the buildings people upgrade, once each', () => {
    expect(ordinary).toEqual(['Watchtower', 'Mart', 'Military Center']);
  });

  it('drops furniture, one-level objects, nameless rows and the ones the owner named', () => {
    for (const name of ['Arena', 'Bank', 'Road', 'Bed', 'Generator', 'Truck', 'Gathering Hall']) {
      expect(list.map((s) => s.name)).not.toContain(name);
    }
    expect(list.map((s) => s.subject)).not.toContain('449000');
    expect(list.map((s) => s.subject)).not.toContain('727000');
    expect(isOffered(b('9', 'Defunct Portal Gate', 10))).toBe(false);
  });

  it('puts season buildings into season groups when the catalogue has none', () => {
    expect(groupBySeason(list).map((g) => [g.label, g.subjects.map((s) => s.name)])).toEqual([
      ['Season 2', ['Statue of Carnage I', 'Altar I']],
      ['Season 3', ['Thermal Lab']],
      ['Season 4', ['Mineral Factory I']],
      ['Season 1 (unconfirmed)', ['Crystal Factory II', 'Crystal Factory I']],
      ['Altar set, second (season unconfirmed)', ['Obelisk']],
      ['Season 5+ (not played yet)', ['Holy Altar I']],
    ]);
  });

  it("lets the catalogue's own season win once it is imported", () => {
    const [thermal] = buildingsForCalculator([b('862000', 'Thermal Lab', 35, 8)]);
    expect(thermal?.gameSeason).toBe(8);
    expect(fallbackSeason('400000')).toBeNull();
  });
});
