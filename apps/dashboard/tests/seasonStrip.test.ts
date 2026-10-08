import { describe, expect, it } from 'vitest';
import type { SeasonAllianceRow, SeasonPlayerRow } from '../src/features/season/boards';
import type { BuildingGrid, MemberBuildings } from '../src/features/season/buildings';
import { allianceStrip, buildingsStrip, playerStrip } from '../src/features/season/strip';

const kind = (id: number, name: string) => ({ id, name });

function member(levels: Record<number, number | null>): MemberBuildings {
  const out: Record<string, unknown> = { playerId: 'p', name: 'm', gameUid: 1, seen: null };
  for (const [id, level] of Object.entries(levels)) out[`b${id}`] = level;
  return out as unknown as MemberBuildings;
}

const grid = (over: Partial<BuildingGrid> = {}): BuildingGrid => ({
  members: [],
  columns: [kind(862000, 'Thermal Lab'), kind(863000, 'Strategic Barrack')],
  capturedAt: null,
  unnamedSeen: 0,
  rosterTotal: null,
  ...over,
});

describe('buildingsStrip', () => {
  it('counts members and buildings, and says what it does not know', () => {
    const cells = buildingsStrip(
      grid({ members: [member({}), member({})], rosterTotal: 84 }),
      new Map(),
    );

    expect(cells.map((c) => [c.label, c.value])).toEqual([
      ['Members seen', '2'],
      ['Buildings', '2'],
    ]);
    expect(cells[0]?.note).toBe('of 84 in the roster');
    expect(cells[1]?.note).toBe('all named');
  });

  it('has no roster note when the roster could not be read', () => {
    expect(buildingsStrip(grid(), new Map())[0]?.note).toBeUndefined();
  });

  it('says how many types the map shows that are not named', () => {
    expect(buildingsStrip(grid({ unnamedSeen: 3 }), new Map())[1]?.note).toBe(
      '3 more on the map, not named',
    );
  });

  it('adds who is under a floor only when floors are set, and counts a member once', () => {
    const members = [
      member({ 862000: 10, 863000: 10 }),
      member({ 862000: 30, 863000: 30 }),
      member({ 862000: null, 863000: null }),
    ];
    const floors = new Map([
      [862000, 20],
      [863000, 20],
    ]);
    const cells = buildingsStrip(grid({ members }), floors);

    expect(cells[2]).toEqual({ label: 'Under a floor', value: '1', note: 'of 3 seen' });
    expect(buildingsStrip(grid({ members }), new Map())).toHaveLength(2);
  });
});

describe('ranking strips', () => {
  const alliance = (rank: number | null, name: string, score: number | null): SeasonAllianceRow =>
    ({ rank, name, abbr: 'AB', score }) as unknown as SeasonAllianceRow;
  const player = (rank: number | null, name: string, force: number | null): SeasonPlayerRow =>
    ({ rank, name, force }) as unknown as SeasonPlayerRow;

  it('names who is first by rank, whatever order the rows arrive in', () => {
    const cells = allianceStrip([alliance(2, 'Second', 1), alliance(1, 'First', 1_500_000)]);

    expect(cells[0]).toEqual({ label: 'Alliances ranked', value: '2' });
    expect(cells[1]?.value).toBe('[AB] First');
    expect(cells[1]?.note).toBe('1.5M points');
  });

  it('does the same for players', () => {
    const cells = playerStrip([player(3, 'C', 5), player(1, 'A', 8200)]);

    expect(cells[1]?.value).toBe('A');
    expect(cells[1]?.note).toBe('8.2K influence');
  });

  it('shows a dash rather than a first place nobody holds', () => {
    expect(allianceStrip([])[1]?.value).toBeNull();
    expect(playerStrip([])[1]?.value).toBeNull();
  });
});
