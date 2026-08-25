import { expect, test } from 'vitest';
import { SEASON2_BUILDINGS, SEASON3_BUILDINGS, isBehind, levelKey } from './buildings';

test('a member is not flagged behind on a building nobody has seen', () => {
  // An absent level means the collector never panned over it. Flagging that
  // accuses somebody of falling behind on the strength of a gap in our own
  // coverage — the same reason the cell renders a dash rather than a zero.
  const member = {
    playerId: 'p',
    name: 'Somebody',
    gameUid: 1,
    oldestSeen: null,
    [levelKey(862000)]: null,
  } as never;

  expect(isBehind(member, [{ id: 862000, name: 'Thermal Lab' }], 10)).toBe(false);
});

test('a member below the level IS flagged', () => {
  const member = {
    playerId: 'p',
    name: 'Somebody',
    gameUid: 1,
    oldestSeen: null,
    [levelKey(862000)]: 4,
  } as never;

  expect(isBehind(member, [{ id: 862000, name: 'Thermal Lab' }], 10)).toBe(true);
});

test('the two catalogues do not share an id', () => {
  // The catalogue IS the season filter, so an id in both would put a season 2
  // building on the season 3 board and vice versa.
  const three = new Set(SEASON3_BUILDINGS.map((b) => b.id));
  const overlap = SEASON2_BUILDINGS.filter((b) => three.has(b.id));

  expect(overlap).toEqual([]);
});

test('every catalogue entry is named, never a bare id', () => {
  // "851000" tells a reader nothing they can act on. Provisional names are
  // allowed and marked; an empty one is not.
  for (const kind of [...SEASON3_BUILDINGS, ...SEASON2_BUILDINGS]) {
    expect(kind.name.trim()).not.toBe('');
    expect(kind.name).not.toMatch(/^\d+$/);
  }
});
