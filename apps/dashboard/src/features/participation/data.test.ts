import { describe, expect, it } from 'vitest';
import { type ParticipationRow, changedEntries, isLow, share, sortRows, sortValue } from './data';

function row(name: string, over: Partial<ParticipationRow> = {}): ParticipationRow {
  return {
    player_id: `id-${name}`,
    current_name: name,
    game_uid: 1,
    member_rank: 3,
    duel_days_read: 10,
    duel_days_on_board: 10,
    duel_days_scored: 8,
    duel_weeks_read: 2,
    duel_weeks_on_board: 2,
    duel_weeks_scored: 2,
    duel_total: 1000,
    donation_days_read: 10,
    donation_days_on_board: 9,
    donation_days_scored: 9,
    donation_weeks_read: 2,
    donation_weeks_on_board: 2,
    donation_weeks_scored: 2,
    donation_total: 500,
    black_gold_listed: 2,
    black_gold_played: 2,
    black_gold_starter_missed: 0,
    black_gold_substitute_missed: 0,
    season_levels_gained: 3,
    watchtower_level: 30,
    watchtower_gained: 1,
    typed_events: { frankie: { held: 2, attended: 1, missed: 1 } },
    duel_days_over: null,
    donation_days_over: null,
    ...over,
  };
}

describe('share and isLow', () => {
  it('nothing read is nothing to judge, not a zero', () => {
    expect(share(0, 0)).toBeNull();
    expect(isLow(0, 0)).toBe(false);
  });
  it('under half is low; half is not', () => {
    expect(isLow(4, 10)).toBe(true);
    expect(isLow(5, 10)).toBe(false);
  });
});

describe('sortRows', () => {
  const rows = [
    row('Bravo', { duel_days_scored: 2 }),
    row('alpha', { duel_days_scored: 9 }),
    // Nothing read: sorts last both ways.
    row('Charlie', { duel_days_read: 0, duel_days_on_board: 0, duel_days_scored: 0 }),
  ];

  it('sorts names without regard to case', () => {
    expect(sortRows(rows, 'name', false).map((r) => r.current_name)).toEqual([
      'alpha',
      'Bravo',
      'Charlie',
    ]);
  });
  it('sorts by share of read days, unread last when descending', () => {
    expect(sortRows(rows, 'duel_days', true).map((r) => r.current_name)).toEqual([
      'alpha',
      'Bravo',
      'Charlie',
    ]);
  });
  it('and unread last when ascending too', () => {
    expect(sortRows(rows, 'duel_days', false).map((r) => r.current_name)).toEqual([
      'Bravo',
      'alpha',
      'Charlie',
    ]);
  });
  it('a typed event sorts by attended share, and a member with no tally is unjudged', () => {
    expect(sortValue(row('x'), 'typed:frankie')).toBe(0.5);
    expect(sortValue(row('x'), 'typed:ice_pit')).toBeNull();
  });
});

describe('changedEntries', () => {
  it('sends only what differs from the record', () => {
    const stored = new Map([
      ['a', true],
      ['b', false],
    ]);
    const draft = new Map<string, boolean | null>([
      ['a', true],
      ['b', true],
      ['c', false],
    ]);
    expect(changedEntries(stored, draft)).toEqual([
      { player_id: 'b', attended: true },
      { player_id: 'c', attended: false },
    ]);
  });
  it('clearing a recorded member sends a null; clearing an unrecorded one sends nothing', () => {
    const stored = new Map([['a', true]]);
    const draft = new Map<string, boolean | null>([
      ['a', null],
      ['b', null],
    ]);
    expect(changedEntries(stored, draft)).toEqual([{ player_id: 'a', attended: null }]);
  });
});

describe('days over the bar', () => {
  it('sorts by the share of read days that reached it', () => {
    const rows = [
      row('Low', { duel_days_over: 2 }),
      row('High', { duel_days_over: 9 }),
      row('NoBar', { duel_days_over: null }),
    ];
    expect(sortRows(rows, 'duel_over', true).map((r) => r.current_name)).toEqual([
      'High',
      'Low',
      'NoBar',
    ]);
  });
  it('no bar sorts last whichever way the column is turned', () => {
    const rows = [row('NoBar', { donation_days_over: null }), row('A', { donation_days_over: 1 })];
    expect(sortRows(rows, 'donation_over', false)[1]?.current_name).toBe('NoBar');
    expect(sortRows(rows, 'donation_over', true)[1]?.current_name).toBe('NoBar');
  });
  it('a day over the bar of an unread board is nothing to judge', () => {
    expect(sortValue(row('X', { duel_days_over: 0, duel_days_read: 0 }), 'duel_over')).toBeNull();
  });
});
