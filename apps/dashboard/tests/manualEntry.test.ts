// Typing scores and roster changes in by hand (0176).
//
// The failures worth guarding are the quiet ones: a week named by the wrong
// instant is refused by the database, a comma in a pasted score would be
// refused or — worse — an empty box saved as zero, and a `%` in a search
// would match the whole server.

import { describe, expect, test } from 'vitest';
import { searchPattern } from '../src/features/admin/ManualRosterSetting';
import { entriesFrom, parseScore, recentWeeks } from '../src/features/admin/ManualScoresSetting';

describe('recentWeeks', () => {
  test('names each week by its Monday 02:00 UTC reset, newest first', () => {
    expect(recentWeeks(new Date('2026-09-25T12:00:00Z'), 3)).toEqual([
      '2026-09-21T02:00:00.000Z',
      '2026-09-14T02:00:00.000Z',
      '2026-09-07T02:00:00.000Z',
    ]);
  });

  test('before the Monday reset it is still last week', () => {
    expect(recentWeeks(new Date('2026-09-21T01:59:00Z'), 1)).toEqual(['2026-09-14T02:00:00.000Z']);
  });
});

describe('parseScore', () => {
  test('an empty box is no value, not zero', () => {
    expect(parseScore('')).toBeNull();
    expect(parseScore('   ')).toBeNull();
  });

  test('the commas a game screen prints are dropped', () => {
    expect(parseScore('1,234,567')).toBe(1_234_567);
    expect(parseScore(' 12 000 ')).toBe(12_000);
  });

  test('zero is a value somebody can mean', () => {
    expect(parseScore('0')).toBe(0);
  });

  test('anything else is flagged rather than guessed at', () => {
    expect(parseScore('12k')).toBeNaN();
    expect(parseScore('-5')).toBeNaN();
    expect(parseScore('1.5')).toBeNaN();
  });
});

describe('entriesFrom', () => {
  test('only what was typed goes out, board by board', () => {
    const entries = entriesFrom(
      new Map([
        ['a', { duel: '1,000', donation: '' }],
        ['b', { duel: '', donation: '' }],
        ['c', { duel: '0', donation: '300' }],
      ]),
    );
    expect(entries).toEqual([
      { player_id: 'a', duel: 1000, donation: null },
      { player_id: 'c', duel: 0, donation: 300 },
    ]);
  });
});

describe('searchPattern', () => {
  test('a name is searched anywhere in the name', () => {
    expect(searchPattern(' Mira ')).toBe('%Mira%');
  });

  test('one letter is not a search', () => {
    expect(searchPattern('M')).toBeNull();
  });

  test('wildcards typed by accident do not widen it', () => {
    expect(searchPattern('%_')).toBeNull();
    expect(searchPattern('a_b%')).toBe('%ab%');
  });
});
