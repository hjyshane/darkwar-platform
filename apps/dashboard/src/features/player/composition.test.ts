import { describe, expect, it } from 'vitest';
import { type BoardRow, composeBoards, rankedBoards, sharesAddUp } from './composition';

const row = (metric: string, power: number | null, rank: number | null, day: string): BoardRow => ({
  metric,
  power,
  rank,
  captured_at: `${day}T02:10:00Z`,
});

// The six components of one profile read (0109: they sum exactly to power).
const six = [
  row('hero_power_total', 10, null, '2026-11-08'),
  row('pet_power_total', 20, null, '2026-11-08'),
  row('science_power', 30, null, '2026-11-08'),
  row('mod_car_power', 40, null, '2026-11-08'),
  row('army_power', 50, null, '2026-11-08'),
  row('building_power', 60, null, '2026-11-08'),
];

describe('composeBoards', () => {
  it('takes the value from the newest row of either source and the rank from the newest ranked row', () => {
    const boards = composeBoards(
      [
        row('hero_power_total', 70_857_050, null, '2026-11-08'),
        row('hero_power_total', 70_000_000, 3, '2026-11-01'),
        row('hero_power_total', 69_000_000, 2, '2026-10-25'),
      ],
      null,
    );
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ metric: 'hero_power_total', value: 70_857_050, rank: 3 });
    expect(boards[0]?.capturedAt).toBe('2026-11-08T02:10:00Z');
  });

  it('profile metrics never carry a rank, whatever the row says', () => {
    const [board] = composeBoards([row('building_power', 100, 7, '2026-11-08')], null);
    expect(board?.rank).toBeNull();
  });

  it('omits boards with no row and ignores metrics that are not boards', () => {
    const boards = composeBoards(
      [
        row('hero_power_total', 10, 1, '2026-11-08'),
        row('pet_power_total', 5, 2, '2026-11-08'),
        row('hero_power_best', 4, 1, '2026-11-08'),
        row('migrate_power', 3, null, '2026-11-08'),
        row('mod_car_power', null, null, '2026-11-08'),
      ],
      null,
    );
    expect(boards.map((board) => board.metric)).toEqual(['hero_power_total', 'pet_power_total']);
  });

  it('sorts by value descending', () => {
    expect(composeBoards(six, 210).map((board) => board.value)).toEqual([60, 50, 40, 30, 20, 10]);
  });

  it('excludes troops from the share denominator', () => {
    const boards = composeBoards(six, 210);
    const by = Object.fromEntries(boards.map((board) => [board.metric, board.share]));
    expect(by.army_power).toBeNull();
    expect(by.building_power).toBeCloseTo(60 / 160);
    expect(by.hero_power_total).toBeCloseTo(10 / 160);
  });

  it('omits every share when the boards do not sum to the total within 2%', () => {
    const boards = composeBoards(six, 300);
    expect(boards.every((board) => board.share === null)).toBe(true);
    expect(sharesAddUp(boards, 300)).toBe(false);
    expect(sharesAddUp(boards, 214)).toBe(true);
    expect(sharesAddUp(boards, 215)).toBe(false);
  });

  it('partial boards never show shares', () => {
    const boards = composeBoards(
      [
        row('hero_power_total', 70_857_050, 3, '2026-11-08'),
        row('pet_power_total', 7_977_471, 9, '2026-11-08'),
      ],
      344_948_617,
    );
    expect(boards.every((board) => board.share === null)).toBe(true);
  });

  it('a null total has no shares', () => {
    expect(composeBoards(six, null).every((board) => board.share === null)).toBe(true);
  });
});

describe('rankedBoards', () => {
  it('keeps only the boards with a game rank, named for the sentence', () => {
    const boards = composeBoards(
      [
        row('hero_power_total', 10, 3, '2026-11-08'),
        ...six.filter((r) => r.metric !== 'hero_power_total'),
      ],
      null,
    );
    expect(rankedBoards(boards)).toEqual([{ noun: 'heroes', rank: 3 }]);
  });
});
