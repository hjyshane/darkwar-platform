import { describe, expect, it } from 'vitest';
import { type BossCell, compactDamage, foldBossDamage, sortMembers } from './data';

function cell(day: string, id: string, damage: number | null, name = id): BossCell {
  return {
    event_day: day,
    player_id: id,
    game_uid: 1,
    current_name: name,
    member_rank: 3,
    damage,
    rank: null,
    source: damage === null ? null : 'captured',
  };
}

const GRID: BossCell[] = [
  cell('2026-10-11', 'a', 300, 'Alpha'),
  cell('2026-10-11', 'b', null, 'Bravo'),
  cell('2026-10-05', 'a', 100, 'Alpha'),
  cell('2026-10-05', 'b', 50, 'Bravo'),
];

describe('foldBossDamage', () => {
  const report = foldBossDamage(GRID);

  it('lists the events oldest first', () => {
    expect(report.days).toEqual(['2026-10-05', '2026-10-11']);
  });

  it('puts each member on the same axis, null where they have nothing', () => {
    const bravo = report.members.find((m) => m.player_id === 'b');
    expect(bravo?.damages).toEqual([50, null]);
    expect(bravo?.attended).toBe(1);
    expect(bravo?.held).toBe(2);
  });

  it('totals, averages and finds the best over the events they hit', () => {
    const alpha = report.members.find((m) => m.player_id === 'a');
    expect(alpha).toMatchObject({ total: 400, average: 200, best: 300, attended: 2 });
  });

  it('change is the newest hit against the one before it', () => {
    expect(report.members.find((m) => m.player_id === 'a')?.change).toBe(200);
    expect(report.members.find((m) => m.player_id === 'b')?.change).toBeNull();
  });

  it('totals each event and counts who hit the boss', () => {
    expect(report.events).toEqual([
      { day: '2026-10-05', participants: 2, total: 150, average: 75, turnout: 1 },
      { day: '2026-10-11', participants: 1, total: 300, average: 300, turnout: 0.5 },
    ]);
  });

  it('an empty grid is an empty report', () => {
    expect(foldBossDamage([])).toEqual({ days: [], members: [], events: [] });
  });
});

describe('sortMembers', () => {
  const members = foldBossDamage([
    ...GRID,
    cell('2026-10-05', 'c', null, 'Charlie'),
    cell('2026-10-11', 'c', null, 'Charlie'),
  ]).members;

  it('sorts by total, descending', () => {
    expect(sortMembers(members, 'total', true).map((m) => m.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });

  it('puts members with no value last whichever way round', () => {
    expect(sortMembers(members, 'average', true).at(-1)?.name).toBe('Charlie');
    expect(sortMembers(members, 'average', false).at(-1)?.name).toBe('Charlie');
  });
});

describe('compactDamage', () => {
  it('shortens by magnitude', () => {
    expect(compactDamage(64_059_759_378)).toBe('64.1G');
    expect(compactDamage(2_500_000)).toBe('2.5M');
    expect(compactDamage(1_500)).toBe('1.5K');
    expect(compactDamage(12)).toBe('12');
  });
});
