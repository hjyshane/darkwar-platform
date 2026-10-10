import { describe, expect, it } from 'vitest';
import {
  NAME_ZOOM,
  NO_ALLIANCE_COLOR,
  NO_BASE_FILTER,
  OURS_COLOR,
  allianceColor,
  allianceSummary,
  byPower,
  centroid,
  clusters,
  filterActive,
  formatCopyCoordinate,
  isShielded,
  isStale,
  matchesFilter,
  parseAtlas,
  parseCoordinate,
  parsePower,
  searchAtlas,
  shieldLeft,
  shieldedCounts,
  visibleLabels,
  visibleNames,
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

describe('base filters', () => {
  const atlas = parseAtlas(json);
  const now = new Date('2026-10-09T00:00:00Z');
  const keep = (filter: Partial<typeof NO_BASE_FILTER>) =>
    atlas.bases
      .filter((b) => matchesFilter(b, { ...NO_BASE_FILTER, ...filter }, now))
      .map((b) => b.gameUid);

  it('keeps everything when no filter is set', () => {
    expect(filterActive(NO_BASE_FILTER)).toBe(false);
    expect(keep({})).toEqual([1, 2, 3, 4]);
  });

  it('keeps an HQ range, both ends included', () => {
    expect(keep({ hqMin: 30 })).toEqual([1, 2]);
    expect(keep({ hqMax: 29 })).toEqual([3, 4]);
    expect(keep({ hqMin: 29, hqMax: 30 })).toEqual([1, 3]);
  });

  it('keeps power under a limit and drops a base whose power is unknown', () => {
    expect(keep({ powerUnder: 150 })).toEqual([1, 3]);
  });

  it('can hide what was last seen over a day ago', () => {
    const old = new Date('2026-10-12T00:00:00Z');
    const stale = atlas.bases.filter((b) =>
      matchesFilter(b, { ...NO_BASE_FILTER, hideStale: true }, old),
    );

    expect(stale).toEqual([]);
    expect(filterActive({ ...NO_BASE_FILTER, hideStale: true })).toBe(true);
  });
});

describe('parsePower', () => {
  it('reads the way power is written', () => {
    expect(parsePower('135m')).toBe(135_000_000);
    expect(parsePower('2.5B')).toBe(2_500_000_000);
    expect(parsePower('800k')).toBe(800_000);
    expect(parsePower('1200')).toBe(1200);
  });

  it('is null for anything else', () => {
    expect(parsePower('')).toBeNull();
    expect(parsePower('lots')).toBeNull();
    expect(parsePower('12x')).toBeNull();
  });
});

describe('shield, copy format and clusters', () => {
  const NOW = new Date('2026-10-09T12:00:00Z');
  const future = Math.floor(NOW.getTime() / 1000) + 7200;
  const past = Math.floor(NOW.getTime() / 1000) - 7200;
  const shieldJson = {
    alliances: [{ id: 'a-big', code: 'BIG', name: 'Big Ones', bases: 5, power: 1 }],
    bases: [
      [1, 10, 10, 30, 1, 0, past, 'S1', future],
      [2, 12, 10, 30, 1, 0, past, 'S2', past],
      [3, 10, 12, 30, 1, 0, past, 'S3', null],
      [4, 12, 12, 30, 1, 0, past, 'S4'],
      [5, 11, 11, 30, 1, 0, past, 'S5', future],
    ],
  };
  const atlas = parseAtlas(shieldJson);
  const keep = (shield: 'all' | 'shielded' | 'open') =>
    atlas.bases
      .filter((b) => matchesFilter(b, { ...NO_BASE_FILTER, shield }, NOW))
      .map((b) => b.gameUid);

  it('reads when a shield ends and treats a past or missing one as no shield', () => {
    expect(atlas.bases.map((b) => isShielded(b, NOW))).toEqual([true, false, false, false, true]);
    expect(atlas.bases[3]?.shieldEnd).toBeNull();
  });

  it('filters to shielded or open bases, and counts shielded ones per alliance', () => {
    expect(keep('shielded')).toEqual([1, 5]);
    expect(keep('open')).toEqual([2, 3, 4]);
    expect(keep('all')).toEqual([1, 2, 3, 4, 5]);
    expect(filterActive({ ...NO_BASE_FILTER, shield: 'open' })).toBe(true);
    expect(shieldedCounts(atlas, NOW)).toEqual([2]);
  });

  it('writes a coordinate the way it is pasted, and reads that back', () => {
    expect(formatCopyCoordinate({ x: 123, y: 45 })).toBe('[X:123 Y:45]');
    expect(parseCoordinate('[X:123 Y:45]')).toEqual({ x: 123, y: 45 });
    expect(parseCoordinate('x:123 y:45')).toEqual({ x: 123, y: 45 });
  });

  it('finds a sizeable alliance clump, its middle and a radius that covers it', () => {
    const found = clusters(atlas);

    expect(found).toHaveLength(1);
    expect(found[0]?.at).toEqual({ x: 11, y: 11 });
    expect(found[0]?.radius).toBeGreaterThanOrEqual(8);
  });

  it('leaves a small alliance without a clump', () => {
    const small = parseAtlas({ ...shieldJson, bases: shieldJson.bases.slice(0, 3) });

    expect(clusters(small)).toEqual([]);
  });
});

describe('visibleLabels', () => {
  const near = (id: string, x: number, y: number, bases: number) => ({ id, x, y, bases });
  const build = (list: Array<{ id: string; x: number; y: number; bases: number }>) => {
    const alliances = list.map((a) => ({
      id: a.id,
      code: a.id,
      name: a.id,
      bases: a.bases,
      power: 0,
    }));
    const found = list.map((a, i) => ({ alliance: i, at: { x: a.x, y: a.y }, radius: 10 }));
    return { atlas: { alliances, bases: [] }, found };
  };

  it('keeps the bigger of two clumps that sit on each other and drops the smaller', () => {
    const { atlas, found } = build([near('small', 100, 100, 6), near('big', 110, 100, 50)]);

    expect(visibleLabels(found, atlas, 1).map((c) => atlas.alliances[c.alliance]?.id)).toEqual([
      'big',
    ]);
  });

  it('keeps both when they are far apart', () => {
    const { atlas, found } = build([near('a', 100, 100, 10), near('b', 600, 700, 9)]);

    expect(visibleLabels(found, atlas, 1)).toHaveLength(2);
  });

  it('brings the smaller one back once zoomed in far enough to tell them apart', () => {
    const { atlas, found } = build([near('small', 100, 100, 6), near('big', 130, 100, 50)]);

    expect(visibleLabels(found, atlas, 1)).toHaveLength(1);
    expect(visibleLabels(found, atlas, 4)).toHaveLength(2);
  });
});

describe('visibleNames', () => {
  const near = parseAtlas({
    alliances: [{ id: 'a', code: 'A', name: 'A', bases: 3, power: 1 }],
    bases: [
      [1, 100, 100, 30, 900, 0, 1_790_000_000, 'Strong'],
      [2, 102, 100, 30, 100, 0, 1_790_000_000, 'Weak'],
      [3, 500, 500, 30, 50, 0, 1_790_000_000, 'Far away'],
    ],
  });

  it('draws no base names until zoomed in', () => {
    expect(visibleNames(near, NAME_ZOOM - 1).size).toBe(0);
  });

  it('drops a name that would sit on a stronger one, and keeps the far one', () => {
    expect([...visibleNames(near, NAME_ZOOM)].sort()).toEqual([1, 3]);
  });

  it('brings the dropped name back once zoomed far enough to separate them', () => {
    expect(visibleNames(near, 64).has(2)).toBe(true);
  });

  it('names only the highlighted set, and a base with no alliance only once clicked', () => {
    const mixed = parseAtlas({
      alliances: [{ id: 'a', code: 'A', name: 'A', bases: 1, power: 1 }],
      bases: [
        [1, 100, 100, 30, 900, 0, 1_790_000_000, 'In'],
        [2, 300, 300, 30, 800, 0, 1_790_000_000, 'Out'],
        [3, 500, 500, 30, 700, -1, 1_790_000_000, 'Loner'],
      ],
    });
    expect([...visibleNames(mixed, NAME_ZOOM)].sort()).toEqual([1, 2]);
    expect([...visibleNames(mixed, NAME_ZOOM, new Set(), new Set([1]))]).toEqual([1]);
    expect([...visibleNames(mixed, NAME_ZOOM, new Set(), null, 3)].sort()).toEqual([1, 2, 3]);
  });

  it('places the picked base first even when it is the weaker one', () => {
    expect(visibleNames(near, NAME_ZOOM, new Set([2])).has(2)).toBe(true);
    expect(visibleNames(near, NAME_ZOOM, new Set([2])).has(1)).toBe(false);
  });
});

describe('allianceSummary', () => {
  const atlas = parseAtlas({
    alliances: [{ id: 'a', code: 'A', name: 'A', bases: 3, power: 1 }],
    bases: [
      [1, 10, 10, 30, 300, 0, 1_790_000_000, 'Top'],
      [2, 11, 11, 30, 100, 0, 1_790_000_000, 'Mid'],
      [3, 12, 12, 30, null, 0, 1_790_000_000, 'Unread'],
      [4, 13, 13, 30, 999, -1, 1_790_000_000, 'Other'],
    ],
  });
  it('sums only the profiles read and says how many that is', () => {
    const s = allianceSummary(atlas, 0, new Date());
    expect(s).toMatchObject({ bases: 3, realPower: 400, profilesRead: 2 });
    expect(s.strongest.map((b) => b.name)).toEqual(['Top', 'Mid']);
  });
});

describe('shieldLeft', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it('reads hours and minutes under a day', () => {
    expect(shieldLeft(at(23 * 60 + 5), now)).toBe('23h 5m');
  });

  it('reads minutes under an hour and under a minute', () => {
    expect(shieldLeft(at(42), now)).toBe('42m');
    expect(shieldLeft(new Date(now.getTime() + 20_000), now)).toBe('<1m');
  });

  it('reads days and hours from a day up', () => {
    expect(shieldLeft(at(2 * 1440 + 3 * 60 + 10), now)).toBe('2d 3h');
  });

  it('is null once the shield has ended', () => {
    expect(shieldLeft(at(-1), now)).toBeNull();
  });
});
