import { describe, expect, test } from 'vitest';
import type { GiftCode, GiftMember } from './data';
import {
  allSelected,
  byRank,
  claimLabel,
  claimableSelection,
  isLive,
  pickableUids,
  rankGroups,
  rankLabel,
  summarise,
  toggleGroup,
} from './status';

function code(over: Partial<GiftCode> = {}): GiftCode {
  return {
    code_id: 'c1',
    code: 'MAPLE3',
    status: 'working',
    source: 'officer',
    first_seen_at: '2026-10-09T00:00:00Z',
    checked_at: null,
    members: 68,
    queued: 0,
    running: 0,
    done: 0,
    already: 0,
    failed: 0,
    other: 0,
    ...over,
  };
}

describe('claimLabel', () => {
  test('names each status the worker writes', () => {
    expect(claimLabel('queued')).toBe('waiting');
    expect(claimLabel('running')).toBe('sending');
    expect(claimLabel('done')).toBe('received');
    expect(claimLabel('already')).toBe('had it');
    expect(claimLabel('failed')).toBe('failed');
  });

  test('no claim at all is a dash', () => {
    expect(claimLabel(undefined)).toBe('—');
  });

  test('a status this page does not know is shown as it came, not hidden', () => {
    expect(claimLabel('rate_limited')).toBe('rate_limited');
  });
});

describe('isLive', () => {
  test('unverified and working codes can be claimed; dead ones cannot', () => {
    expect(isLive({ status: 'unverified' })).toBe(true);
    expect(isLive({ status: 'working' })).toBe(true);
    expect(isLive({ status: 'expired' })).toBe(false);
    expect(isLive({ status: 'invalid' })).toBe(false);
  });
});

describe('summarise', () => {
  test('received counts both a new reward and one they already had', () => {
    const s = summarise(code({ done: 50, already: 5, queued: 3, running: 1, failed: 2 }));
    expect(s.received).toBe(55);
    expect(s.waiting).toBe(4);
    expect(s.failed).toBe(2);
    expect(s.untouched).toBe(7);
  });

  test('a code nobody has been queued for has the whole roster untouched', () => {
    expect(summarise(code()).untouched).toBe(68);
  });

  test('cancelled and refused pairs are untouched again, not in flight', () => {
    expect(summarise(code({ done: 60, other: 8 })).untouched).toBe(8);
  });

  test('never goes below zero when the roster shrank under a finished code', () => {
    expect(summarise(code({ members: 60, done: 68 })).untouched).toBe(0);
  });
});

describe('claimableSelection', () => {
  const members: GiftMember[] = [
    { game_uid: 1, name: 'Alpha', excluded: false, claims: {}, rank: 5 },
    { game_uid: 2, name: 'Bravo', excluded: true, claims: {}, rank: 4 },
    { game_uid: 3, name: 'Charlie', excluded: false, claims: {}, rank: 4 },
  ];

  test('picks the selected players who are not excluded', () => {
    expect(claimableSelection(members, new Set([1, 2]))).toEqual([1]);
  });

  test('an empty selection claims for nobody, not for everyone', () => {
    expect(claimableSelection(members, new Set())).toEqual([]);
  });
});

describe('picking by rank', () => {
  const member = (
    game_uid: number,
    name: string,
    rank: number | null,
    excluded = false,
  ): GiftMember => ({ game_uid, name, excluded, claims: {}, rank });
  const roster = [
    member(1, 'Ann', 5),
    member(2, 'Bob', 4),
    member(3, 'Cy', 4, true),
    member(4, 'Di', 4),
    member(5, 'Ed', 1),
    member(6, 'Flo', null),
  ];

  test('writes a rank as R and a number, and a dash when it is not known', () => {
    expect(rankLabel(3)).toBe('R3');
    expect(rankLabel(null)).toBe('—');
  });

  test('offers R5 down to R1 then those with no rank, and leaves out a group nobody can be picked from', () => {
    expect(rankGroups(roster).map((group) => group.label)).toEqual(['R5', 'R4', 'R1', 'No rank']);
    expect(rankGroups([member(1, 'Ann', 5, true)])).toEqual([]);
  });

  test('a group never includes a player who is left out, but counts them in its total', () => {
    const r4 = rankGroups(roster).find((group) => group.label === 'R4');

    expect(r4?.uids).toEqual([2, 4]);
    expect(r4?.total).toBe(3);
  });

  test('all is everybody but the players left out', () => {
    expect(pickableUids(roster)).toEqual([1, 2, 4, 5, 6]);
  });

  test('a press selects the group, and another press takes it out again', () => {
    const r4 = rankGroups(roster).find((group) => group.label === 'R4')?.uids ?? [];
    const once = toggleGroup(new Set<number>(), r4);

    expect([...once].sort()).toEqual([2, 4]);
    expect(allSelected(once, r4)).toBe(true);
    expect(toggleGroup(once, r4).size).toBe(0);
  });

  test('groups add up, and taking one out leaves the others', () => {
    const groups = rankGroups(roster);
    const r5 = groups.find((g) => g.label === 'R5')?.uids ?? [];
    const r4 = groups.find((g) => g.label === 'R4')?.uids ?? [];
    const both = toggleGroup(toggleGroup(new Set<number>(), r5), r4);

    expect([...both].sort()).toEqual([1, 2, 4]);
    expect([...toggleGroup(both, r4)]).toEqual([1]);
  });

  test('a group with only some of it selected is selected in full by the next press', () => {
    const r4 = rankGroups(roster).find((group) => group.label === 'R4')?.uids ?? [];
    const partial = new Set([2]);

    expect(allSelected(partial, r4)).toBe(false);
    expect([...toggleGroup(partial, r4)].sort()).toEqual([2, 4]);
  });

  test('an empty group is never "all selected"', () => {
    expect(allSelected(new Set([1]), [])).toBe(false);
  });

  test('orders highest rank first, then by name, with unknown ranks last', () => {
    expect(byRank(roster).map((m) => m.name)).toEqual(['Ann', 'Bob', 'Cy', 'Di', 'Ed', 'Flo']);
  });
});
