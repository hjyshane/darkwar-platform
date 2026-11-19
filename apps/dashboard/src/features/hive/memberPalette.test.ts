// The editor's member list: who counts as placed, and the rows it shows.

import { describe, expect, test } from 'vitest';
import type { AssignableMember } from '../../lib/hiveFormation';
import type { DraftSlot } from './FormationEditor';
import { paletteRows, placedTiles, shortPower } from './memberPalette';

function tile(slotId: string | null, dx = 0, dy = 0): DraftSlot {
  return {
    dx,
    dy,
    spanX: 3,
    spanY: 3,
    ordinal: 1,
    label: '',
    kind: 'base',
    colour: null,
    slotId,
  };
}

function member(
  playerId: string,
  name: string | null,
  power: number | null = null,
  memberRank: number | null = null,
): AssignableMember {
  return { playerId, name, power, hqLevel: null, memberRank };
}

describe('who counts as placed', () => {
  test('a member dragged onto a saved base, then the base clicked away, is unplaced at once', () => {
    // The report: drop Mira on saved slot s1, click s1's base to take it
    // away — and Mira stayed greyed in the list until the next save, because
    // s1 was still in the SAVED board.
    const assignments = new Map([['s1', 'mira']]);
    expect(placedTiles(assignments, [tile('s1')]).has('mira')).toBe(true);
    expect(placedTiles(assignments, []).has('mira')).toBe(false);
  });

  test('a base dragged somewhere else keeps its member', () => {
    // The moved tile carries the slot id it came from.
    const moved = tile('s1', 9, -6);
    const placed = placedTiles(new Map([['s1', 'mira']]), [moved]);
    expect(placed.get('mira')).toBe(moved);
  });

  test('a base drawn since the last save counts by its stand-in id', () => {
    const fresh = tile('draft-1', 3, 0);
    expect(placedTiles(new Map([['draft-1', 'dex']]), [fresh]).get('dex')).toBe(fresh);
  });

  test('a stand-in id that outlived its tile places nobody', () => {
    expect(placedTiles(new Map([['draft-1', 'dex']]), [tile('s1')]).size).toBe(0);
  });

  test('tiles with no slot id are nobody’s', () => {
    expect(placedTiles(new Map([['s1', 'mira']]), [tile(null)]).size).toBe(0);
  });
});

describe('the rows', () => {
  const roster = [
    member('shane', 'Shane', 61_200_000, 5),
    member('dex', 'Dex', null, 1),
    member('mira', 'Mira', 48_000_000, 4),
    member('bo', 'bo', 12_000_000, null),
  ];
  const onTile = tile('s1');
  const placed = new Map([['mira', onTile]]);

  test('A–Z by default, each row carrying its tile or null', () => {
    const rows = paletteRows(roster, placed, { query: '', sort: 'name', hidePlaced: false });
    expect(rows.map((row) => row.member.playerId)).toEqual(['bo', 'dex', 'mira', 'shane']);
    expect(rows.find((row) => row.member.playerId === 'mira')?.tile).toBe(onTile);
    expect(rows.find((row) => row.member.playerId === 'dex')?.tile).toBeNull();
  });

  test('by power and by rank, with the unknown last', () => {
    const byPower = paletteRows(roster, placed, { query: '', sort: 'power', hidePlaced: false });
    expect(byPower.map((row) => row.member.playerId)).toEqual(['shane', 'mira', 'bo', 'dex']);
    const byRank = paletteRows(roster, placed, { query: '', sort: 'rank', hidePlaced: false });
    expect(byRank.map((row) => row.member.playerId)).toEqual(['shane', 'mira', 'dex', 'bo']);
  });

  test('placing somebody does not move their row', () => {
    const before = paletteRows(roster, new Map(), { query: '', sort: 'name', hidePlaced: false });
    const after = paletteRows(roster, placed, { query: '', sort: 'name', hidePlaced: false });
    expect(after.map((row) => row.member.playerId)).toEqual(
      before.map((row) => row.member.playerId),
    );
  });

  test('"Hide placed" leaves only the people still to place', () => {
    const rows = paletteRows(roster, placed, { query: '', sort: 'name', hidePlaced: true });
    expect(rows.map((row) => row.member.playerId)).toEqual(['bo', 'dex', 'shane']);
  });

  test('the search narrows, together with hiding', () => {
    expect(
      paletteRows(roster, placed, { query: 'MI', sort: 'name', hidePlaced: false }).map(
        (row) => row.member.playerId,
      ),
    ).toEqual(['mira']);
    expect(paletteRows(roster, placed, { query: 'mi', sort: 'name', hidePlaced: true })).toEqual(
      [],
    );
  });
});

describe('power, as the game prints it', () => {
  test('millions with one decimal, thousands rounded, nothing when unread', () => {
    expect(shortPower(61_234_567)).toBe('61.2M');
    expect(shortPower(1_000_000)).toBe('1.0M');
    expect(shortPower(512_400)).toBe('512k');
    expect(shortPower(null)).toBe('');
  });
});
