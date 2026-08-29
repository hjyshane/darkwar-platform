import { expect, test } from 'vitest';
import type { BuildingGrid } from './buildings';
import {
  SEASON2_BUILDINGS,
  SEASON3_BUILDINGS,
  buildingsBehind,
  isBehind,
  levelKey,
  membersMissing,
  stallOf,
  stalledCount,
} from './buildings';

const LAB = { id: 862000, name: 'Thermal Lab' };
const HOUSE = { id: 857000, name: 'Smart Green House 1' };

/** A member with the levels given, and nothing else known about them. */
function member(levels: Record<number, number | null>) {
  const row: Record<string, unknown> = {
    playerId: 'p',
    name: 'Somebody',
    gameUid: 1,
    oldestSeen: null,
  };
  for (const [id, level] of Object.entries(levels)) {
    row[levelKey(Number(id))] = level;
  }
  return row as never;
}

// 0158. One level for every building marked the whole alliance for the
// building nobody had started, so the floor is now per building — and a
// building with no floor set is not judged at all.
test('a building with no floor set is never behind', () => {
  const row = member({ 862000: 3, 857000: 20 });
  // Only the greenhouse has a floor, and it clears it. The lab at 3 is not
  // judged, because nobody said it should be.
  expect(buildingsBehind(row, [LAB, HOUSE], new Map([[857000, 19]]))).toEqual([]);
});

test('only the building under its own floor is named', () => {
  const row = member({ 862000: 3, 857000: 20 });
  const behind = buildingsBehind(
    row,
    [LAB, HOUSE],
    new Map([
      [862000, 19],
      [857000, 19],
    ]),
  );
  expect(behind.map((kind) => kind.id)).toEqual([862000]);
});

test('two floors can be missed at once', () => {
  const row = member({ 862000: 3, 857000: 4 });
  const behind = buildingsBehind(
    row,
    [LAB, HOUSE],
    new Map([
      [862000, 19],
      [857000, 19],
    ]),
  );
  expect(behind.map((kind) => kind.id)).toEqual([862000, 857000]);
});

// The rule that predates the per-building floors and outlives them: an empty
// cell is a gap in OUR coverage, not a member who built nothing.
test('an unseen building is not behind, whatever the floor', () => {
  const row = member({ 862000: null });
  expect(buildingsBehind(row, [LAB], new Map([[862000, 19]]))).toEqual([]);
});

function grid(members: number, rosterTotal: number | null): BuildingGrid {
  return {
    members: Array.from({ length: members }, (_, index) => ({
      playerId: `p${index}`,
      name: `m${index}`,
      gameUid: index,
      oldestSeen: null,
    })) as BuildingGrid['members'],
    columns: [],
    capturedAt: null,
    unnamedSeen: 0,
    rosterTotal,
  };
}

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

  expect(isBehind(member, [{ id: 862000, name: 'Thermal Lab' }], new Map([[862000, 10]]))).toBe(
    false,
  );
});

test('a member below the level IS flagged', () => {
  const member = {
    playerId: 'p',
    name: 'Somebody',
    gameUid: 1,
    oldestSeen: null,
    [levelKey(862000)]: 4,
  } as never;

  expect(isBehind(member, [{ id: 862000, name: 'Thermal Lab' }], new Map([[862000, 10]]))).toBe(
    true,
  );
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

test('the board counts the members it cannot show', () => {
  // The bug that started this: 67 of 84 displayed, and nothing said so.
  expect(membersMissing(grid(67, 84))).toBe(17);
  expect(membersMissing(grid(84, 84))).toBe(0);
});

test('an unreadable roster is unknown, never zero', () => {
  // Zero would render as a complete board, which is exactly the wrong
  // reassurance — the same shape as reporting "not scanned" as "not there".
  expect(membersMissing(grid(67, null))).toBeNull();
});

test('more members than the roster does not report a negative', () => {
  // Possible while the roster snapshot lags a departure. "-2 have no
  // building observed" is nonsense on a screen.
  expect(membersMissing(grid(86, 84))).toBe(0);
});

const NOW = new Date('2026-08-29T12:00:00Z');

/** A member with one building at `level`, first seen at `since`, last observed
 * at `seen`. */
function watched(typeId: number, level: number | null, since: string | null, seen: string | null) {
  return {
    playerId: 'p',
    name: 'Somebody',
    gameUid: 1,
    oldestSeen: null,
    levelSince: { [typeId]: since },
    seenAt: { [typeId]: seen },
    [levelKey(typeId)]: level,
  } as never;
}

test('a level that has not moved inside the window is stalled', () => {
  const member = watched(862000, 12, '2026-08-26T12:00:00Z', '2026-08-29T11:00:00Z');

  expect(stallOf(member, { id: 862000, name: 'Thermal Lab' }, NOW)).toBe('stalled');
});

test('a level that moved recently is not', () => {
  const member = watched(862000, 12, '2026-08-29T06:00:00Z', '2026-08-29T11:00:00Z');

  expect(stallOf(member, { id: 862000, name: 'Thermal Lab' }, NOW)).toBe('moving');
});

test('a building nobody has looked at recently is unobserved, never stalled', () => {
  // THE DISTINCTION THIS EXISTS FOR. The level has not changed in a week, but
  // neither has anybody swept it — calling that a stall accuses a member on
  // the strength of a gap in our own map coverage. On the live data 749 of
  // 1,251 cells are in exactly this state against 156 genuinely unchanged, so
  // collapsing the two would make the board mostly wrong.
  const member = watched(862000, 12, '2026-08-20T12:00:00Z', '2026-08-25T12:00:00Z');

  expect(stallOf(member, { id: 862000, name: 'Thermal Lab' }, NOW)).toBe('unobserved');
});

test('a building nobody has built is neither', () => {
  const member = watched(862000, null, null, null);

  expect(stallOf(member, { id: 862000, name: 'Thermal Lab' }, NOW)).toBe('unbuilt');
});

test('a run older than the view window counts as stalled, not unknown', () => {
  // The view searches 30 days for the start of the current level; past that it
  // stores null. Null there means "longer ago than we look", which is older
  // than any threshold worth setting — so it is a stall, and treating it as
  // unknown would hide the members who have been stopped the longest.
  const member = watched(862000, 12, null, '2026-08-29T11:00:00Z');

  expect(stallOf(member, { id: 862000, name: 'Thermal Lab' }, NOW)).toBe('stalled');
});

test('each building carries its own window', () => {
  // Build times grow with the level, so two days is a long pause on a
  // greenhouse and barely a start on a late thermal lab.
  const member = watched(862000, 12, '2026-08-26T12:00:00Z', '2026-08-29T11:00:00Z');

  expect(stallOf(member, { id: 862000, name: 'Lab', stallHours: 120 }, NOW)).toBe('moving');
  expect(stallOf(member, { id: 862000, name: 'Lab', stallHours: 24 }, NOW)).toBe('stalled');
});

test('the stalled count reads a whole row at once', () => {
  const member = {
    ...(watched(862000, 12, '2026-08-20T12:00:00Z', '2026-08-29T11:00:00Z') as object),
    levelSince: { 862000: '2026-08-20T12:00:00Z', 857000: '2026-08-29T09:00:00Z' },
    seenAt: { 862000: '2026-08-29T11:00:00Z', 857000: '2026-08-29T11:00:00Z' },
    [levelKey(857000)]: 4,
  } as never;

  expect(stalledCount(member, SEASON3_BUILDINGS, NOW)).toBe(1);
});
