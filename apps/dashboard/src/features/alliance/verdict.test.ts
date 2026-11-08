import { describe, expect, it } from 'vitest';
import { type AllianceVerdictFacts, composeAllianceVerdict, standingFacts } from './verdict';

const NONE: AllianceVerdictFacts = {
  rank: null,
  total: null,
  serverId: null,
  power: null,
  above: null,
  below: null,
  joinRule: null,
  minPower: null,
  minHq: null,
};

describe('composeAllianceVerdict', () => {
  it('reads the lead for the leader', () => {
    const text = composeAllianceVerdict({
      ...NONE,
      rank: 1,
      total: 12,
      serverId: 580,
      power: 15_300_000_000,
      below: { tag: 'CLaw', power: 14_100_000_000 },
    });
    expect(text).toBe('#1 of 12 alliances on 580, 1.2G ahead of [CLaw].');
  });

  it('reads the gap for everybody else', () => {
    const text = composeAllianceVerdict({
      ...NONE,
      rank: 2,
      total: 12,
      serverId: 580,
      power: 14_100_000_000,
      above: { tag: 'ADET', power: 15_300_000_000 },
      below: { tag: 'XYZ', power: 1 },
    });
    expect(text).toBe('#2 of 12 alliances on 580, 1.2G behind [ADET].');
  });

  it('stops after the server when the neighbour has no power read', () => {
    const text = composeAllianceVerdict({
      ...NONE,
      rank: 3,
      total: 12,
      serverId: 580,
      power: 100,
      above: { tag: 'ADET', power: null },
    });
    expect(text).toBe('#3 of 12 alliances on 580.');
  });

  it('adds the join rule and both minimums', () => {
    const text = composeAllianceVerdict({
      ...NONE,
      joinRule: 'approval',
      minPower: 30_000_000,
      minHq: 20,
    });
    expect(text).toBe('Joins need approval · 30M and HQ 20 minimum.');
  });

  it('gives the minimums alone while the join rule is unconfirmed', () => {
    expect(composeAllianceVerdict({ ...NONE, minPower: 30_000_000, minHq: 20 })).toBe(
      '30M and HQ 20 minimum.',
    );
    expect(composeAllianceVerdict({ ...NONE, minHq: 20 })).toBe('HQ 20 minimum.');
    expect(composeAllianceVerdict({ ...NONE, joinRule: 'open' })).toBe('Open join.');
  });

  it('joins both sentences', () => {
    const text = composeAllianceVerdict({
      ...NONE,
      rank: 4,
      total: 9,
      serverId: 581,
      minHq: 25,
    });
    expect(text).toBe('#4 of 9 alliances on 581. HQ 25 minimum.');
  });

  it('is empty when nothing is known', () => {
    expect(composeAllianceVerdict(NONE)).toBe('');
  });
});

describe('standingFacts', () => {
  const rows = [
    { alliance_id: 'c', power: 100, code: 'CCC' },
    { alliance_id: 'a', power: 300, code: 'AAA' },
    { alliance_id: 'n', power: null, code: 'NNN' },
    { alliance_id: 'b', power: 200, code: 'BBB' },
  ];

  it('ranks by power with neighbours either side', () => {
    expect(standingFacts(rows, 'b')).toEqual({
      rank: 2,
      total: 4,
      power: 200,
      above: { tag: 'AAA', power: 300 },
      below: { tag: 'CCC', power: 100 },
    });
  });

  it('puts a missing power last and the leader has nobody above', () => {
    expect(standingFacts(rows, 'n').rank).toBe(4);
    expect(standingFacts(rows, 'a').above).toBeNull();
  });

  it('knows nothing about an alliance that is not in the rows', () => {
    expect(standingFacts(rows, 'zzz')).toEqual({
      rank: null,
      total: null,
      power: null,
      above: null,
      below: null,
    });
  });
});
