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
  b('864000', 'Armed Turret I', 8),
  b('865000', 'Defensive Base I', 8),
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
      ['Season 3', ['Thermal Lab', 'Defensive Base I']],
      ['Season 4', ['Mineral Factory I']],
      ['Altar set, second (season unconfirmed)', ['Obelisk']],
    ]);
  });

  it('leaves out Season 1 and the seasons nobody has played (owner, 2026-11-18)', () => {
    const names = list.map((s) => s.name);
    for (const name of ['Crystal Factory I', 'Crystal Factory II', 'Holy Altar I']) {
      expect(names).not.toContain(name);
    }
    // ...and the same themes when the catalogue names them itself.
    expect(
      buildingsForCalculator([b('1001000', 'Holy Altar I', 30, 8), b('1002000', 'X', 30, 10)]),
    ).toEqual([]);
  });

  it('leaves out turrets, season or not, and keeps the defensive base beside them', () => {
    expect(list.map((s) => s.name)).not.toContain('Armed Turret I');
    expect(list.map((s) => s.name)).toContain('Defensive Base I');
    expect(isOffered(b('9', 'Armed Turret II', 8))).toBe(false);
    expect(isOffered(b('9', 'Turret', 30))).toBe(false);
  });

  it("lets the catalogue's own season win once it is imported", () => {
    const [obelisk] = buildingsForCalculator([b('764000', 'Obelisk', 30, 2)]);
    expect(obelisk?.gameSeason).toBe(2);
    expect(fallbackSeason('400000')).toBeNull();
  });
});
