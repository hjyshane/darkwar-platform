import { describe, expect, it } from 'vitest';
import type { Subject } from '../planner/data';
import { groupBySeason, isSeasonBuilding, seasonLabel } from './seasons';

function subject(id: string, name: string, gameSeason: number | null): Subject {
  return { subject: id, name, nameKo: null, maxLevel: 30, category: null, gameSeason };
}

describe('seasonLabel', () => {
  it("names the seasons we have played by our number and the rest by the game's", () => {
    expect(seasonLabel(4)).toBe('Season 3');
    expect(seasonLabel(3)).toBe('Season 2');
    expect(seasonLabel(6)).toBe('Game season 6');
  });
});

describe('groupBySeason', () => {
  it('groups season buildings by theme, in order, and drops ordinary buildings', () => {
    const groups = groupBySeason([
      subject('409000', 'Bank', null),
      subject('873000', 'Oni Seal Hall', 6),
      subject('868000', 'Mineral Factory I', 6),
      subject('862000', 'Thermal Lab', 4),
    ]);
    expect(groups.map((g) => [g.gameSeason, g.label])).toEqual([
      [4, 'Season 3'],
      [6, 'Game season 6'],
    ]);
    expect(groups[1]?.subjects.map((s) => s.subject)).toEqual(['868000', '873000']);
    expect(isSeasonBuilding(subject('409000', 'Bank', null))).toBe(false);
    expect(isSeasonBuilding(subject('862000', 'Thermal Lab', 4))).toBe(true);
  });

  it('is empty when nothing has a season', () => {
    expect(groupBySeason([subject('409000', 'Bank', null)])).toEqual([]);
  });
});
