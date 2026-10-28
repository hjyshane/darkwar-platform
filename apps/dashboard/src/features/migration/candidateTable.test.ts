import { describe, expect, test } from 'vitest';
import {
  ALL,
  NONE,
  NO_FILTERS,
  type ViewRow,
  applyFilters,
  buildRows,
  facets,
  nextSort,
  sortRows,
} from './candidateTable';
import type { Candidate, CandidateColumn, Found, OwnAlliance } from './candidates';

const alliances: OwnAlliance[] = [
  { alliance_id: 'a1', current_name: 'Alpha', current_code: 'ALP' },
  { alliance_id: 'a2', current_name: 'Beta', current_code: null },
];

const columns: CandidateColumn[] = [
  { column_id: 'n', label: 'Level', sort_order: 1, kind: 'number', options: [] },
  {
    column_id: 'd',
    label: 'Status',
    sort_order: 2,
    kind: 'dropdown',
    options: ['Asked', 'Yes', 'No'],
  },
  { column_id: 't', label: 'Who', sort_order: 3, kind: 'text', options: [] },
];

const cand = (
  query: string,
  extra: Record<string, string> = {},
  desired: string | null = null,
  game_uid: number | null = null,
): Candidate => ({ candidate_id: query, query, game_uid, desired_alliance_id: desired, extra });

const found = (over: Partial<Found>): Found => ({
  game_uid: 1,
  name: 'x',
  server_id: 570,
  alliance_name: null,
  power: 100,
  place: 5000,
  estimated: false,
  captured_at: '2026-10-27T12:00:00Z',
  source: 'state list',
  migrate_power: null,
  migrate_power_at: null,
  ...over,
});

function rows(): ViewRow[] {
  const table: Record<string, Found[]> = {
    ann: [found({ name: 'Ann', server_id: 570, power: 300, place: 5, alliance_name: 'Crew' })],
    bob: [found({ name: 'Bob', server_id: 571, power: 200, place: 100, alliance_name: 'Gang' })],
    cat: [found({ name: 'Cat', server_id: 570, power: 100, place: 2500, estimated: true })],
    dan: [],
  };
  const list = [
    cand('ann', { n: '10', d: 'Yes' }, 'a1'),
    cand('bob', { n: '9', d: 'Asked' }, 'a2'),
    cand('cat', { n: '100', d: 'No', t: 'Zed' }),
    cand('dan', {}, null, 1234567890000584),
  ];
  return buildRows(list, (c) => table[c.query] ?? [], alliances, 'backbone');
}

const order = (rs: ViewRow[]) => rs.map((r) => r.candidate.query);

describe('buildRows', () => {
  test('tier, server and alliances per row', () => {
    const [ann, , cat, dan] = rows();
    expect(ann).toMatchObject({
      tier: 'commander',
      server: 570,
      allianceNow: 'Crew',
      desiredLabel: '[ALP] Alpha',
    });
    expect(cat?.tier).toBe('backbone');
    expect(dan).toMatchObject({ server: 584, serverGuessed: true, tier: 'backbone' });
  });
});

describe('applyFilters', () => {
  test('by server', () => {
    expect(order(applyFilters(rows(), { ...NO_FILTERS, server: '570' }))).toEqual(['ann', 'cat']);
  });

  test('by tier', () => {
    expect(order(applyFilters(rows(), { ...NO_FILTERS, tier: 'commander' }))).toEqual(['ann']);
    expect(order(applyFilters(rows(), { ...NO_FILTERS, tier: 'backbone' }))).toEqual([
      'cat',
      'dan',
    ]);
  });

  test('by the 580 alliance, and by none chosen', () => {
    expect(order(applyFilters(rows(), { ...NO_FILTERS, desired: 'a2' }))).toEqual(['bob']);
    expect(order(applyFilters(rows(), { ...NO_FILTERS, desired: NONE }))).toEqual(['cat', 'dan']);
  });

  test('by the alliance they are in now, and by none known', () => {
    expect(order(applyFilters(rows(), { ...NO_FILTERS, allianceNow: 'Gang' }))).toEqual(['bob']);
    expect(order(applyFilters(rows(), { ...NO_FILTERS, allianceNow: NONE }))).toEqual([
      'cat',
      'dan',
    ]);
  });

  test('by text, and filters combine', () => {
    expect(order(applyFilters(rows(), { ...NO_FILTERS, search: 'AN' }))).toEqual(['ann', 'dan']);
    expect(order(applyFilters(rows(), { ...NO_FILTERS, server: '570', tier: 'backbone' }))).toEqual(
      ['cat'],
    );
    expect(order(applyFilters(rows(), { ...NO_FILTERS, server: ALL }))).toHaveLength(4);
  });
});

describe('facets', () => {
  test('the servers and alliances present', () => {
    expect(facets(rows())).toEqual({ servers: [570, 571, 584], alliancesNow: ['Crew', 'Gang'] });
  });
});

describe('sortRows', () => {
  test('numbers sort as numbers, not as text', () => {
    const asc = sortRows(rows(), { key: 'col:n', direction: 'asc' }, columns);
    expect(order(asc)).toEqual(['bob', 'ann', 'cat', 'dan']);
  });

  test('a dropdown sorts in the order of its list', () => {
    const asc = sortRows(rows(), { key: 'col:d', direction: 'asc' }, columns);
    expect(order(asc)).toEqual(['bob', 'ann', 'cat', 'dan']);
  });

  test('empty cells go last either way round', () => {
    const desc = sortRows(rows(), { key: 'col:t', direction: 'desc' }, columns);
    expect(order(desc)[0]).toBe('cat');
    expect(order(desc).slice(1)).toEqual(['ann', 'bob', 'dan']);
  });

  test('power, place and tier', () => {
    expect(
      order(sortRows(rows(), { key: 'power', direction: 'desc' }, columns)).slice(0, 3),
    ).toEqual(['ann', 'bob', 'cat']);
    expect(
      order(sortRows(rows(), { key: 'place', direction: 'asc' }, columns)).slice(0, 3),
    ).toEqual(['ann', 'bob', 'cat']);
    expect(order(sortRows(rows(), { key: 'tier', direction: 'asc' }, columns))[0]).toBe('ann');
  });

  test('no sort keeps the order they were added in', () => {
    expect(order(sortRows(rows(), null, columns))).toEqual(['ann', 'bob', 'cat', 'dan']);
  });
});

describe('nextSort', () => {
  test('ascending, descending, then off', () => {
    const a = nextSort(null, 'power');
    expect(a).toEqual({ key: 'power', direction: 'asc' });
    const b = nextSort(a, 'power');
    expect(b).toEqual({ key: 'power', direction: 'desc' });
    expect(nextSort(b, 'power')).toBeNull();
    expect(nextSort(b, 'name')).toEqual({ key: 'name', direction: 'asc' });
  });
});
