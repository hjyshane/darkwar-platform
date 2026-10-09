import { describe, expect, it } from 'vitest';
import {
  NO_ALLIANCE_COLOR,
  OURS_COLOR,
  allianceColor,
  byPower,
  centroid,
  isStale,
  parseAtlas,
  parseCoordinate,
  searchAtlas,
} from './atlas';

const json = {
  alliances: [
    { id: 'a-big', code: 'BIG', name: 'Big Ones', bases: 2, power: 400 },
    { id: 'a-small', code: 'SML', name: 'Small', bases: 1, power: 50 },
  ],
  bases: [
    [1, 10, 20, 30, 100, 0, 1_790_000_000, 'Alpha'],
    [2, 11, 21, 31, 300, 0, 1_790_000_000, 'Bravo'],
    [3, 12, 22, 29, 50, 1, 1_790_000_000, 'Charlie'],
    [4, 13, 23, 28, null, -1, 1_790_000_000, null],
  ],
};

describe('parseAtlas', () => {
  it('reads alliances and bases, with the alliance as an index', () => {
    const atlas = parseAtlas(json);

    expect(atlas.alliances.map((a) => a.code)).toEqual(['BIG', 'SML']);
    expect(atlas.bases).toHaveLength(4);
    expect(atlas.bases[1]).toMatchObject({
      gameUid: 2,
      at: { x: 11, y: 21 },
      alliance: 0,
      power: 300,
    });
    expect(atlas.bases[3]?.alliance).toBe(-1);
    expect(atlas.bases[3]?.power).toBeNull();
  });

  it('drops a base it cannot place instead of drawing it at the corner', () => {
    const atlas = parseAtlas({
      ...json,
      bases: [[1, null, 20, 30, 1, 0, 1], 'junk', ...json.bases],
    });

    expect(atlas.bases).toHaveLength(4);
  });

  it('treats an alliance index it does not know as none', () => {
    const atlas = parseAtlas({ ...json, bases: [[1, 1, 1, 1, 1, 7, 1_790_000_000, 'x']] });

    expect(atlas.bases[0]?.alliance).toBe(-1);
  });

  it('is empty for anything that is not the expected object', () => {
    expect(parseAtlas(null).bases).toEqual([]);
    expect(parseAtlas('x').alliances).toEqual([]);
  });
});

describe('allianceColor', () => {
  it('is the same for the same id and differs between ids', () => {
    expect(allianceColor('a-big')).toBe(allianceColor('a-big'));
    expect(allianceColor('a-big')).not.toBe(allianceColor('a-small'));
  });

  it('gives our alliance its own colour and no alliance a grey', () => {
    expect(allianceColor('a-big', true)).toBe(OURS_COLOR);
    expect(allianceColor(null)).toBe(NO_ALLIANCE_COLOR);
  });
});

describe('parseCoordinate', () => {
  it('reads the ways a coordinate is written', () => {
    expect(parseCoordinate('446:393')).toEqual({ x: 446, y: 393 });
    expect(parseCoordinate(' 446, 393 ')).toEqual({ x: 446, y: 393 });
    expect(parseCoordinate('446 393')).toEqual({ x: 446, y: 393 });
  });

  it('does not take a name or a lone number for one', () => {
    expect(parseCoordinate('Alpha')).toBeNull();
    expect(parseCoordinate('446')).toBeNull();
    expect(parseCoordinate('1234:5')).toBeNull();
  });
});

describe('searchAtlas', () => {
  const atlas = parseAtlas(json);

  it('finds an alliance by its code or name and brings its bases along', () => {
    const found = searchAtlas(atlas, 'big');

    expect(found).toMatchObject({ kind: 'text', alliances: [0] });
    expect(found.kind === 'text' && found.bases.map((b) => b.gameUid)).toEqual([1, 2]);
  });

  it('finds a player by name', () => {
    const found = searchAtlas(atlas, 'charl');

    expect(found.kind === 'text' && found.bases.map((b) => b.gameUid)).toEqual([3]);
  });

  it('finds the bases nearest a coordinate', () => {
    const found = searchAtlas(atlas, '12:22');

    expect(found.kind === 'coordinate' && found.nearest[0]?.gameUid).toBe(3);
  });

  it('is not a search under two characters', () => {
    expect(searchAtlas(atlas, 'a')).toEqual({ kind: 'none' });
    expect(searchAtlas(atlas, '')).toEqual({ kind: 'none' });
  });
});

describe('byPower, centroid, isStale', () => {
  const atlas = parseAtlas(json);

  it('lists the strongest first and the unknown last', () => {
    expect(byPower(atlas.bases).map((b) => b.gameUid)).toEqual([2, 1, 3, 4]);
  });

  it('finds the middle of a set of bases', () => {
    expect(centroid(atlas.bases.slice(0, 2))).toEqual({ x: 11, y: 21 });
    expect(centroid([])).toBeNull();
  });

  it('calls a sighting older than a day stale', () => {
    const base = { seenAt: new Date('2026-10-09T00:00:00Z') };

    expect(isStale(base, new Date('2026-10-09T12:00:00Z'))).toBe(false);
    expect(isStale(base, new Date('2026-10-10T01:00:00Z'))).toBe(true);
  });
});
