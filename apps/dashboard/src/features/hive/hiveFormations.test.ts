// Reading a formation past PostgREST's one-response cap.
//
// The failure being guarded is silent: one request for a 1,200-tile board
// returns 1,000 rows and no error, and the editor draws a formation that looks
// whole with its last 200 tiles missing.

import { describe, expect, test } from 'vitest';
import { type BoardSlot, everyPage, vacateDeparted } from './hiveFormations';

function table(rows: number) {
  const all = Array.from({ length: rows }, (_, i) => i);
  const asked: [number, number][] = [];
  const page = (from: number, to: number) => {
    asked.push([from, to]);
    return Promise.resolve({ data: all.slice(from, to + 1), error: null });
  };
  return { all, asked, page };
}

describe('everyPage', () => {
  test('reads past 1,000 rows instead of stopping at the first page', async () => {
    const { all, asked, page } = table(2500);
    const { data, error } = await everyPage(page);
    expect(error).toBeNull();
    expect(data).toEqual(all);
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test('an exact multiple of the page costs one empty request, not a lost page', async () => {
    const { all, asked, page } = table(1000);
    const { data } = await everyPage(page);
    expect(data).toEqual(all);
    expect(asked).toHaveLength(2);
  });

  test('an empty board is one request', async () => {
    const { asked, page } = table(0);
    const { data } = await everyPage(page);
    expect(data).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  test('an error on a later page is returned, not swallowed into a short board', async () => {
    let calls = 0;
    const { data, error } = await everyPage((from, to) => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? { data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null }
          : { data: null, error: { code: '57014', message: 'canceling statement' } },
      );
    });
    expect(error?.code).toBe('57014');
    expect(data).toHaveLength(1000);
  });
});

// A member who left gives their tile up.

function boardSlot(over: Partial<BoardSlot> = {}): BoardSlot {
  return {
    slotId: 'a',
    ordinal: 1,
    label: '',
    spanX: 3,
    spanY: 3,
    kind: 'base',
    colour: null,
    dx: 0,
    dy: 0,
    x: 512,
    y: 388,
    playerId: 'kova',
    playerName: 'Kova',
    hqLevel: 30,
    power: 39_500_000,
    pinned: true,
    stillAMember: false,
    assignedAt: null,
    departedName: null,
    ...over,
  };
}

describe('vacateDeparted', () => {
  test('a member off the roster leaves an empty tile, not a "?"', () => {
    // The bug: the tile kept a member the editor no longer had a name for,
    // and Fill would not touch it because it looked taken.
    const slot = vacateDeparted(boardSlot());

    expect(slot.playerId).toBeNull();
    expect(slot.playerName).toBeNull();
    expect(slot.stillAMember).toBeNull();
  });

  test('their pin goes with them', () => {
    // A pin on an empty tile is refused by the database (0174), and would
    // stop the next Fill from using the tile.
    expect(vacateDeparted(boardSlot()).pinned).toBe(false);
  });

  test('who left is kept for the screen to say', () => {
    expect(vacateDeparted(boardSlot()).departedName).toBe('Kova');
  });

  test('a member still on the roster is left exactly where they are', () => {
    const slot = boardSlot({ stillAMember: true });
    expect(vacateDeparted(slot)).toBe(slot);
  });

  test('an empty tile is left alone', () => {
    const slot = boardSlot({ playerId: null, playerName: null, pinned: false, stillAMember: null });
    expect(vacateDeparted(slot)).toBe(slot);
  });
});
