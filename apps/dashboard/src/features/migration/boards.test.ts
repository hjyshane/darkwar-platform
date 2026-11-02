import { describe, expect, test } from 'vitest';
import { barScale } from '../../components/BarChart';
import {
  net,
  type AllianceStat,
  type ServerStat,
  allianceMoverRows,
  arrangeAlliances,
  movementRows,
  restOfList,
  tierRows,
} from './boards';

const stat = (over: Partial<ServerStat>): ServerStat => ({
  server_id: 570,
  captured_at: '2026-11-02T08:14:00Z',
  listed: 150,
  min_power: 1,
  max_power: 9,
  total_power: 50,
  commanders: 2,
  elites: 5,
  advanced: 40,
  moved_in: 24,
  moved_out: 9,
  ...over,
});

const alliance = (over: Partial<AllianceStat>): AllianceStat => ({
  alliance_id: 'a',
  name: 'Alpha',
  code: 'ALP',
  server_id: 570,
  members: 80,
  total_power: 1000,
  moved: 5,
  commanders: 0,
  elites: 1,
  advanced: 4,
  captured_at: '2026-11-02T08:14:00Z',
  ...over,
});

describe('server stats helpers', () => {
  test('net is arrivals minus departures', () => {
    expect(net(stat({}))).toBe(15);
    expect(net(stat({ moved_in: 1, moved_out: 4 }))).toBe(-3);
  });

  test('the rest of a list is what is below the three tiers', () => {
    expect(restOfList(stat({}))).toBe(103);
    expect(restOfList(stat({ listed: 3, commanders: 2, elites: 2 }))).toBe(0);
  });

  test('a server with no list is left out of the composition chart', () => {
    const rows = tierRows([stat({}), stat({ server_id: 571, listed: 0 })]);
    expect(rows.map((r) => r.label)).toEqual(['570']);
    expect(rows[0]?.segments.map((s) => s.value)).toEqual([2, 5, 40]);
  });

  test('movement puts departures left and arrivals right', () => {
    const [row] = movementRows([stat({})]);
    expect(row?.segments).toMatchObject([
      { key: 'out', side: 'left', value: 9 },
      { key: 'in', side: 'right', value: 24 },
    ]);
  });
});

describe('barScale', () => {
  const rows = movementRows([stat({}), stat({ server_id: 571, moved_in: 3, moved_out: 30 })]);

  test('a diverging chart is as long as its longest side', () => {
    expect(barScale(rows, true)).toBe(30);
  });

  test('a stacked chart is as long as its longest total', () => {
    expect(barScale(tierRows([stat({}), stat({ server_id: 571, commanders: 10 })]), false)).toBe(
      55,
    );
  });

  test('a chart of zeros still has a scale', () => {
    expect(barScale([], true)).toBe(1);
  });
});

describe('arrangeAlliances', () => {
  const rows = [
    alliance({ alliance_id: '1', name: 'Alpha', code: 'ALP', moved: 5, total_power: 900 }),
    alliance({
      alliance_id: '2',
      name: 'Bravo',
      code: 'BRV',
      moved: 20,
      total_power: 100,
      server_id: 571,
    }),
    alliance({ alliance_id: '3', name: 'Charlie', code: null, moved: 0, total_power: null }),
  ];
  const ids = (r: AllianceStat[]) => r.map((x) => x.alliance_id);

  test('by movers, most first', () => {
    expect(ids(arrangeAlliances(rows, '', 'moved', true))).toEqual(['2', '1', '3']);
  });

  test('a missing power goes last either way round', () => {
    expect(ids(arrangeAlliances(rows, '', 'power', true))).toEqual(['1', '2', '3']);
    expect(ids(arrangeAlliances(rows, '', 'power', false))).toEqual(['2', '1', '3']);
  });

  test('search matches name or tag, ignoring case', () => {
    expect(ids(arrangeAlliances(rows, 'brv', 'moved', true))).toEqual(['2']);
    expect(ids(arrangeAlliances(rows, 'CHAR', 'moved', true))).toEqual(['3']);
  });

  test('the chart takes the top alliances by movers and skips those with none', () => {
    expect(allianceMoverRows(rows, 5).map((r) => r.label)).toEqual(['BRV', 'ALP']);
    expect(allianceMoverRows(rows, 1)).toHaveLength(1);
  });
});
