import { describe, expect, test } from 'vitest';
import {
  allianceMovers,
  alliancePowerChange,
  boardShift,
  extremes,
  homeServerOf,
  personRankClimb,
  routes,
  sankey,
  scale,
  serverFlows,
  tierMobility,
} from './analytics';
import type { TierBoardRow } from './candidates';
import type { MigrationAlliance, MigrationPerson } from './data';
import type { Mover } from './movers';

const mover = (uid: number, home: number, now: number, rank: number, power = 100): Mover => ({
  game_uid: uid,
  name: `p${uid}`,
  home_server: home,
  server_id: now,
  alliance_name: null,
  power,
  board_rank: rank,
  captured_at: '2026-11-02T07:00:00Z',
  source: 'list',
});

describe('serverFlows', () => {
  test('counts arrivals, departures and the power each carried', () => {
    const rows = serverFlows([
      mover(1, 588, 580, 3, 500),
      mover(2, 588, 580, 30, 300),
      mover(3, 577, 580, 400, 100),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.server, r]));
    expect(by[580]).toMatchObject({ arrived: 3, left: 0, net: 3, powerIn: 900, powerNet: 900 });
    expect(by[588]).toMatchObject({ arrived: 0, left: 2, net: -2, powerOut: 800, powerNet: -800 });
    expect(by[577]).toMatchObject({ left: 1, net: -1 });
  });

  test('no movers, no servers', () => {
    expect(serverFlows([])).toEqual([]);
  });
});

describe('boardShift', () => {
  const row = (rank: number, uid: number, server: number, power = 10): TierBoardRow => ({
    overall_rank: rank,
    game_uid: uid,
    name: `p${uid}`,
    server_id: server,
    alliance_name: null,
    power,
    captured_at: '2026-11-02T07:00:00Z',
  });

  test('reads the home server off the uid', () => {
    expect(homeServerOf(123_000_588)).toBe(588);
  });

  test('moves a place from the home server to the current one, in its tier', () => {
    const rows = [row(1, 1_000_588, 580), row(20, 1_000_580, 580), row(100, 1_000_577, 577)];
    const by = Object.fromEntries(boardShift(rows).map((s) => [s.server, s]));
    expect(by[580]).toMatchObject({ home: 1, now: 2, net: 1 });
    expect(by[580]?.byTier).toMatchObject({ commander: 1, elite: 0, advanced: 0 });
    expect(by[588]).toMatchObject({ home: 1, now: 0, net: -1 });
    expect(by[588]?.byTier.commander).toBe(-1);
    expect(by[577]).toMatchObject({ net: 0 });
  });

  test('the nets of all servers cancel', () => {
    const rows = [row(1, 1_000_588, 580), row(2, 1_000_577, 580), row(60, 1_000_580, 584)];
    expect(boardShift(rows).reduce((acc, s) => acc + s.net, 0)).toBe(0);
  });
});

describe('tierMobility', () => {
  test('divides a named tier by its size and leaves backbone as a count', () => {
    const rows = tierMobility([
      mover(1, 588, 580, 3),
      mover(2, 588, 580, 9),
      mover(3, 577, 580, 30),
      mover(4, 578, 565, 5000),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.tier, r]));
    expect(by.commander).toMatchObject({ moved: 2, share: 0.2 });
    expect(by.elite).toMatchObject({ moved: 1 });
    expect(by.advanced).toMatchObject({ moved: 0, share: 0 });
    expect(by.backbone).toMatchObject({ moved: 1, share: null });
  });
});

describe('routes', () => {
  test('splits each route by tier, biggest first', () => {
    const rows = routes([mover(1, 588, 580, 3), mover(2, 588, 580, 400), mover(3, 577, 580, 400)]);
    expect(rows[0]).toMatchObject({ from: 588, to: 580, count: 2 });
    expect(rows[0]?.byTier).toMatchObject({ commander: 1, backbone: 1 });
    expect(rows[1]).toMatchObject({ from: 577, count: 1 });
  });
});

describe('extremes', () => {
  test('ranks rises and falls apart and drops zero and unknown', () => {
    const items = [5, -3, 0, null, 9, -1];
    const { up, down } = extremes(items, (x) => x, 2);
    expect(up.map((s) => s.change)).toEqual([9, 5]);
    expect(down.map((s) => s.change)).toEqual([-3, -1]);
  });

  test('takes only as many as asked', () => {
    expect(extremes([1, 2, 3], (x) => x, 1).up).toHaveLength(1);
  });
});

describe('person and alliance changes', () => {
  const person = (before: number | null, after: number | null) =>
    ({ before_rank: before, after_rank: after }) as MigrationPerson;

  test('a smaller place is a climb', () => {
    expect(personRankClimb(person(20, 12))).toBe(8);
    expect(personRankClimb(person(12, 20))).toBe(-8);
  });

  test('a person seen on one side only has no climb', () => {
    expect(personRankClimb(person(null, 12))).toBeNull();
  });

  test('an alliance uses the board figure and falls back to the roster', () => {
    const a = {
      board_power_before: null,
      roster_power_before: 100,
      board_power_after: 160,
      roster_power_after: 999,
    } as MigrationAlliance;
    expect(alliancePowerChange(a)).toBe(60);
  });
});

describe('scale', () => {
  test('is a share of the maximum and never past it', () => {
    expect(scale(-5, 10)).toBe(0.5);
    expect(scale(20, 10)).toBe(1);
    expect(scale(5, 0)).toBe(0);
  });
});

describe('sankey', () => {
  const list = routes([
    mover(1, 588, 580, 3),
    mover(2, 588, 580, 400),
    mover(3, 577, 580, 400),
    mover(4, 577, 565, 400),
  ]);

  test('band thickness adds up to the column height less the gaps', () => {
    const { links, left } = sankey(list, 100, 10);
    expect(links.reduce((acc, l) => acc + l.h, 0)).toBeCloseTo(100 - 10);
    expect(left.map((n) => n.server)).toEqual([577, 588]);
  });

  test('bands of one node do not overlap', () => {
    const { links } = sankey(list, 100, 0);
    const from577 = links.filter((l) => l.from === 577).sort((a, b) => a.y0 - b.y0);
    expect(from577).toHaveLength(2);
    const [first, second] = from577;
    expect((first?.y0 ?? 0) + (first?.h ?? 0) / 2).toBeLessThanOrEqual(
      (second?.y0 ?? 0) - (second?.h ?? 0) / 2 + 1e-9,
    );
  });

  test('no movers, nothing to lay out', () => {
    expect(sankey([], 100)).toEqual({ left: [], right: [], links: [] });
  });
});

describe('allianceMovers', () => {
  const inAlliance = (m: Mover, name: string | null): Mover => ({ ...m, alliance_name: name });

  test('groups movers by alliance, most first, with where they came from', () => {
    const rows = allianceMovers([
      inAlliance(mover(1, 570, 580, 3, 500), 'Wolves'),
      inAlliance(mover(2, 570, 580, 30, 300), 'Wolves'),
      inAlliance(mover(3, 588, 580, 400, 100), 'Wolves'),
      inAlliance(mover(4, 572, 565, 400, 50), 'Bears'),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Wolves', 'Bears']);
    expect(rows[0]).toMatchObject({ server: 580, movers: 3, power: 900 });
    expect(rows[0]?.from).toEqual([
      [570, 2],
      [588, 1],
    ]);
    expect(rows[0]?.byTier).toMatchObject({ commander: 1, elite: 1, backbone: 1 });
  });

  test('leaves out movers with no alliance name', () => {
    expect(allianceMovers([inAlliance(mover(1, 570, 580, 3), null)])).toEqual([]);
  });
});
