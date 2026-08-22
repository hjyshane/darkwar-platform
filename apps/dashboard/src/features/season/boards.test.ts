import { describe, expect, it } from 'vitest';
import { allianceLabel, movement } from './boards';
import { SEASON2_BUILDINGS, SEASON3_BUILDINGS } from './buildings';

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

describe('season building catalogue', () => {
  const s3 = new Map(SEASON3_BUILDINGS.map((k) => [k.id, k.name]));

  it('names every building it is willing to show', () => {
    // The grid renders `columns`, and `columns` is filtered from a
    // catalogue — so a header can never come out as a bare number.
    for (const kind of [...SEASON3_BUILDINGS, ...SEASON2_BUILDINGS]) {
      expect(kind.name).not.toMatch(/^\d+$/);
      expect(kind.name.length).toBeGreaterThan(0);
    }
  });

  it('holds the seven season 3 ids confirmed against a member', () => {
    // WonderingDuck, read off the game: greenhouses 1-4 at 19, 5 at 18,
    // thermal lab 19, strategic barrack 1 — and the ids matched all seven.
    expect(s3.get(862000)).toBe('Thermal Lab');
    expect(s3.get(857000)).toBe('Smart Green House 1');
    expect(s3.get(861000)).toBe('Smart Green House 5');
    expect(s3.get(863000)).toBe('Strategic Barrack');
    expect(SEASON3_BUILDINGS).toHaveLength(7);
  });

  it('reads lab, then greenhouses, then barrack', () => {
    // Editorial order, not id order: the ids put the greenhouses first.
    expect(SEASON3_BUILDINGS.map((k) => k.name)).toEqual([
      'Thermal Lab',
      'Smart Green House 1',
      'Smart Green House 2',
      'Smart Green House 3',
      'Smart Green House 4',
      'Smart Green House 5',
      'Strategic Barrack',
    ]);
  });

  it('keeps the two seasons apart', () => {
    // The catalogue IS the season filter. An id in both would put a season 2
    // building on the board the alliance reads.
    const s2 = new Set(SEASON2_BUILDINGS.map((k) => k.id));
    for (const kind of SEASON3_BUILDINGS) {
      expect(s2.has(kind.id)).toBe(false);
    }
    for (const stale of [743000, 751000, 851000, 853000, 856000]) {
      expect(s2.has(stale)).toBe(true);
      expect(s3.has(stale)).toBe(false);
    }
  });

  it('spells the season 2 counts the alliance gave', () => {
    // One Obelisk, five Altars, one Barrack, two Attack, two Defense — the
    // counts came from a person and total exactly the eleven ids. WHICH id
    // is which is still a guess; the counts are not.
    const names = SEASON2_BUILDINGS.map((k) => k.name);
    const startsWith = (p: string) => names.filter((n) => n.startsWith(p)).length;
    expect(startsWith('Obelisk')).toBe(1);
    expect(startsWith('Altar')).toBe(5);
    expect(startsWith('Barrack')).toBe(1);
    expect(startsWith('Attack')).toBe(2);
    expect(startsWith('Defense')).toBe(2);
  });

  it('marks every season 2 name as provisional', () => {
    // Five names were given for eleven ids. A placeholder that looks like a
    // fact is worse than an id, so the screen has to be able to say so.
    for (const kind of SEASON2_BUILDINGS) {
      expect(kind.provisional).toBe(true);
    }
    expect(SEASON2_BUILDINGS).toHaveLength(11);
  });
});
