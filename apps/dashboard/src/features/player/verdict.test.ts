import { describe, expect, it } from 'vitest';
import { type VerdictFacts, composeVerdict, verdictText } from './verdict';

const now = new Date('2026-11-08T12:00:00Z');
const none: VerdictFacts = { serverId: 580, rank: null, shield: null, boards: [], now };
const mid = { rank: 12, total: 900, gapToAbove: 1_200_000, leadOverBelow: 3_000_000 };
const say = (facts: Partial<VerdictFacts>) => verdictText(composeVerdict({ ...none, ...facts }));

describe('composeVerdict — rank clause', () => {
  it('rank 1 states the lead over the runner-up', () => {
    expect(
      say({ rank: { rank: 1, total: 900, gapToAbove: null, leadOverBelow: 59_400_000 } }),
    ).toBe('Strongest on 580 by 59.4M.');
  });
  it('rank 1 alone on the board has nobody to lead', () => {
    expect(say({ rank: { rank: 1, total: 1, gapToAbove: null, leadOverBelow: null } })).toBe(
      'Strongest on 580.',
    );
  });
  it('a mid rank states the gap to the place above', () => {
    expect(say({ rank: mid })).toBe('#12 on 580, 1.2M behind #11.');
  });
  it('nothing at all when there is no data', () => {
    expect(composeVerdict(none)).toEqual([]);
  });
  it('marks the figures as figures', () => {
    const segments = composeVerdict({ ...none, rank: mid });
    expect(segments[0]).toEqual({ kind: 'figure', text: '#12' });
    expect(segments.filter((s) => s.kind === 'figure').map((s) => s.text)).toEqual([
      '#12',
      '580',
      '1.2M',
      '#11',
    ]);
  });
});

describe('composeVerdict — shield clause', () => {
  it('shield up names the time it ends', () => {
    expect(
      say({
        rank: mid,
        shield: { readAt: '2026-11-08T10:00:00Z', shieldEndAt: '2026-11-08T20:30:00Z' },
      }),
    ).toBe('#12 on 580, 1.2M behind #11. Shield up until 2026-11-08 20:30 UTC.');
  });
  it('shield down names the day it ended', () => {
    expect(
      say({ shield: { readAt: '2026-11-06T08:00:00Z', shieldEndAt: '2026-11-05T22:00:00Z' } }),
    ).toBe('Shield off since 2026-11-05.');
  });
  it('never shielded is simply off', () => {
    expect(say({ shield: { readAt: '2026-11-07T08:00:00Z', shieldEndAt: null } })).toBe(
      'Shield off.',
    );
  });
  it('a read older than seven days says nothing about the shield', () => {
    expect(say({ shield: { readAt: '2026-10-30T08:00:00Z', shieldEndAt: null } })).toBe('');
  });
});

describe('composeVerdict — board clause', () => {
  it('names the #1 boards and the weakest one', () => {
    expect(
      say({
        boards: [
          { noun: 'tech', rank: 1 },
          { noun: 'vehicle', rank: 1 },
          { noun: 'pets', rank: 1 },
          { noun: 'heroes', rank: 2 },
        ],
      }),
    ).toBe('Tech, vehicle, pets #1; heroes #2.');
  });
  it('with no #1 board only the weakest is named', () => {
    expect(
      say({
        boards: [
          { noun: 'heroes', rank: 2 },
          { noun: 'pets', rank: 5 },
        ],
      }),
    ).toBe('Pets #5.');
  });
  it('all #1 has no weakest', () => {
    expect(
      say({
        boards: [
          { noun: 'heroes', rank: 1 },
          { noun: 'pets', rank: 1 },
        ],
      }),
    ).toBe('Heroes, pets #1.');
  });
  it('no composition, no clause', () => {
    expect(say({ rank: mid, boards: [] })).toBe('#12 on 580, 1.2M behind #11.');
  });
});
