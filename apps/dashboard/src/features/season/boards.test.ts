import { describe, expect, it } from 'vitest';
import { allianceLabel, movement } from './boards';
import { BUILDING_NAMES, buildingLabel, isNamed } from './buildings';

describe('movement', () => {
  it('reads a smaller rank as an improvement', () => {
    // 5th last board, 2nd now: three places gained, and the delta is
    // positive even though the rank number went down. This is the assertion
    // that catches the sign being flipped.
    expect(movement(2, 5)).toEqual({ direction: 'up', places: 3 });
  });

  it('reads a larger rank as a fall', () => {
    expect(movement(9, 4)).toEqual({ direction: 'down', places: 5 });
  });

  it('reports no change as flat rather than as a direction', () => {
    expect(movement(7, 7)).toEqual({ direction: 'flat', places: 0 });
  });

  it('treats a previous rank of zero as unranked, not as first place', () => {
    // The game sends 0 for an alliance that was not on the board last time.
    // Read as a position it would make a debut at rank 40 look like the
    // biggest fall on the board.
    expect(movement(40, 0)).toBeNull();
  });

  it('says nothing when either rank is missing', () => {
    expect(movement(null, 3)).toBeNull();
    expect(movement(3, null)).toBeNull();
    expect(movement(null, null)).toBeNull();
  });

  it('reports first place held as flat', () => {
    expect(movement(1, 1)).toEqual({ direction: 'flat', places: 0 });
  });
});

describe('allianceLabel', () => {
  it('puts the tag in brackets before the name', () => {
    expect(allianceLabel('故人歸', 'TWya')).toBe('[TWya] 故人歸');
  });

  it('shows the name alone when there is no tag', () => {
    // No empty brackets: "[] name" reads as a rendering bug.
    expect(allianceLabel('故人歸', null)).toBe('故人歸');
    expect(allianceLabel('故人歸', '')).toBe('故人歸');
  });

  it('shows the tag alone when there is no name', () => {
    expect(allianceLabel(null, 'TWya')).toBe('TWya');
  });

  it('returns null when neither is known, leaving the fallback to the caller', () => {
    expect(allianceLabel(null, null)).toBeNull();
  });
});

describe('building names', () => {
  it('names every building the grid is willing to show', () => {
    // The grid renders `columns`, and `columns` only ever holds named ids —
    // so a label can never come back as a bare number a reader cannot use.
    for (const id of Object.keys(BUILDING_NAMES).map(Number)) {
      expect(isNamed(id)).toBe(true);
      expect(buildingLabel(id)).toBe(BUILDING_NAMES[id]);
      expect(buildingLabel(id)).not.toMatch(/^\d+$/);
    }
  });

  it('refuses last season\u2019s ids', () => {
    // 743000-856000 were last seen 12-16 August and are frozen at level 30;
    // 857000-863000 appeared on 17 August and are still moving. The name is
    // what separates them, so an unnamed id must not pass.
    for (const stale of [743000, 751000, 851000, 853000, 856000]) {
      expect(isNamed(stale)).toBe(false);
    }
  });

  it('knows the seven season 3 buildings confirmed against a member', () => {
    // WonderingDuck, read off the game: 온실 1-4 at 19, 온실 5 at 18,
    // 항온연구소 19, 전략병영 1 — and the ids matched all seven.
    expect(BUILDING_NAMES[857000]).toBe('온실 1');
    expect(BUILDING_NAMES[861000]).toBe('온실 5');
    expect(BUILDING_NAMES[862000]).toBe('항온연구소');
    expect(BUILDING_NAMES[863000]).toBe('전략병영');
    expect(Object.keys(BUILDING_NAMES)).toHaveLength(7);
  });
});
