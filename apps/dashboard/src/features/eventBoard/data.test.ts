import { describe, expect, it } from 'vitest';
import { type BoardCell, compactScore, foldEventBoard, sortMembers } from './data';

function cell(
  day: string,
  name: string,
  attended: boolean | null,
  score: number | null = null,
  damage: number | null = null,
): BoardCell {
  return {
    event_day: day,
    round: 0,
    player_id: `id-${name}`,
    game_uid: 1,
    current_name: name,
    member_rank: null,
    attended,
    score,
    damage,
  };
}

const GRID: BoardCell[] = [
  cell('2026-10-03', 'Alpha', true, 100),
  cell('2026-10-03', 'Bravo', false),
  cell('2026-10-03', 'Charlie', null),
  cell('2026-10-17', 'Alpha', true, 400, 9),
  cell('2026-10-17', 'Bravo', true, 50),
  cell('2026-10-17', 'Charlie', false),
];

describe('foldEventBoard', () => {
  it('keeps every event as a column, oldest first', () => {
    expect(foldEventBoard(GRID).days).toEqual(['2026-10-03', '2026-10-17']);
  });

  it('counts present and absent apart, and leaves not known uncounted', () => {
    const report = foldEventBoard(GRID);
    const by = new Map(report.members.map((m) => [m.name, m] as const));
    expect(by.get('Alpha')).toMatchObject({ present: 2, absent: 0, held: 2 });
    expect(by.get('Bravo')).toMatchObject({ present: 1, absent: 1 });
    // One day not known and one absent: not known is not a miss.
    expect(by.get('Charlie')).toMatchObject({ present: 0, absent: 1 });
  });

  it('totals, averages and compares scores over the events that have one', () => {
    const alpha = foldEventBoard(GRID).members.find((m) => m.name === 'Alpha');
    expect(alpha).toMatchObject({ totalScore: 500, bestScore: 400, averageScore: 250 });
    expect(alpha?.change).toBe(300);
    expect(alpha?.scores).toEqual([100, 400]);
  });

  it('has no change with fewer than two scores, and no average with none', () => {
    const report = foldEventBoard(GRID);
    const bravo = report.members.find((m) => m.name === 'Bravo');
    expect(bravo?.change).toBeNull();
    const charlie = report.members.find((m) => m.name === 'Charlie');
    expect(charlie?.averageScore).toBeNull();
    expect(charlie?.bestScore).toBeNull();
  });

  it('turns out per event as present over the roster, a floor', () => {
    const report = foldEventBoard(GRID);
    expect(report.events[0]).toMatchObject({ present: 1, absent: 1, unknown: 1 });
    expect(report.events[0]?.turnout).toBeCloseTo(1 / 3);
    expect(report.events[1]).toMatchObject({ present: 2, absent: 1, unknown: 0, totalScore: 450 });
  });

  it('withholds a score from a member recorded absent that day', () => {
    const report = foldEventBoard([cell('2026-10-03', 'Alpha', false, 100)]);
    expect(report.members[0]?.scores).toEqual([null]);
  });

  it('knows whether any score or damage is on record', () => {
    expect(foldEventBoard(GRID)).toMatchObject({ hasScore: true, hasDamage: true });
    expect(foldEventBoard([cell('2026-10-03', 'Alpha', true)])).toMatchObject({
      hasScore: false,
      hasDamage: false,
    });
  });

  it('is empty for an empty grid', () => {
    expect(foldEventBoard([])).toMatchObject({ days: [], members: [], events: [] });
  });
});

describe('sortMembers', () => {
  it('puts a member with no value last either way', () => {
    const members = foldEventBoard(GRID).members;
    expect(sortMembers(members, 'total', true).map((m) => m.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(sortMembers(members, 'total', false).map((m) => m.name)).toEqual([
      'Bravo',
      'Alpha',
      'Charlie',
    ]);
  });
});

describe('compactScore', () => {
  it('shortens by thousands', () => {
    expect(compactScore(34_354_291)).toBe('34.4M');
    expect(compactScore(999)).toBe('999');
  });
});
