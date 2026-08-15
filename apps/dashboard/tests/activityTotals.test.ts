import { describe, expect, test } from 'vitest';
import { type ActivityDay, totalsFor } from '../src/lib/activity';

/** Summing per-day activity rows onto the member list (0118).
 *
 * The arithmetic is trivial; the edges are not. `activity_daily` emits a row
 * only for a day something happened, so the member list is what makes somebody
 * who has done nothing appear at all — and those are exactly the people the
 * admin screen exists to find.
 */
function day(overrides: Partial<ActivityDay> & { userId: string }): ActivityDay {
  return {
    day: '2026-08-14',
    loginDays: 0,
    serverDays: 0,
    allianceDays: 0,
    playerDays: 0,
    commentCount: 0,
    points: 0,
    ...overrides,
  };
}

const members = [
  { userId: 'a', displayName: 'Scout' },
  { userId: 'b', displayName: 'Ranger' },
];

describe('totalsFor', () => {
  test('adds every day onto the member who earned it', () => {
    const totals = totalsFor(members, [
      day({ userId: 'a', loginDays: 1, points: 1 }),
      day({ userId: 'a', day: '2026-08-15', loginDays: 1, commentCount: 2, points: 5 }),
    ]);

    const scout = totals.find((total) => total.userId === 'a');
    expect(scout?.loginDays).toBe(2);
    expect(scout?.commentCount).toBe(2);
    expect(scout?.totalPoints).toBe(6);
  });

  test('keeps a member who has done nothing, at zero', () => {
    const totals = totalsFor(members, [day({ userId: 'a', loginDays: 1, points: 1 })]);

    // The screen is for finding these people. A missing row reads as a loading
    // fault, and an absent member reads as "no longer in the alliance".
    const ranger = totals.find((total) => total.userId === 'b');
    expect(ranger).toBeDefined();
    expect(ranger?.totalPoints).toBe(0);
  });

  test('drops days belonging to somebody not on the member list', () => {
    const totals = totalsFor(members, [
      day({ userId: 'a', points: 1 }),
      // What a demoted member's history looks like: `activity_events` keeps the
      // rows, `activity_members` stops listing them. Inventing a row here would
      // put a viewer back on the alliance's score table.
      day({ userId: 'gone', points: 99 }),
    ]);

    expect(totals).toHaveLength(2);
    expect(totals.some((total) => total.userId === 'gone')).toBe(false);
  });

  test('sorts strongest first, which is the order the table wants', () => {
    const totals = totalsFor(members, [
      day({ userId: 'b', points: 4 }),
      day({ userId: 'a', points: 1 }),
    ]);

    expect(totals.map((total) => total.userId)).toEqual(['b', 'a']);
  });

  test('is all zeroes when nothing has happened at all', () => {
    const totals = totalsFor(members, []);

    expect(totals.map((total) => total.totalPoints)).toEqual([0, 0]);
  });

  test('returns nothing when there are no members to score', () => {
    expect(totalsFor([], [day({ userId: 'a', points: 3 })])).toEqual([]);
  });
});
