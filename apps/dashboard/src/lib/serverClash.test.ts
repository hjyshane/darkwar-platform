import { describe, expect, it } from 'vitest';
import {
  type ServerSide,
  coverageWarning,
  leader,
  parseClash,
  shareOfPair,
  sideOf,
} from './serverClash';

const side = (over: Partial<ServerSide>): ServerSide => ({
  server_id: 588,
  alliances_on_board: 3,
  members_seen: 10,
  active_players: 6,
  total_power: 600,
  median_power: 100,
  top_power: 200,
  power_gained: 30,
  growing: 4,
  map_active: 2,
  no_power_reading: 0,
  ...over,
});

describe('parseClash', () => {
  it('reads the three lists and the window', () => {
    const data = parseClash({
      days: 14,
      generated_at: '2026-11-23T00:00:00Z',
      servers: [{ server_id: 580 }],
      alliances: [],
      players: [{ game_uid: '1' }],
    });
    expect(data.days).toBe(14);
    expect(data.servers).toHaveLength(1);
    expect(data.players).toHaveLength(1);
    expect(data.generatedAt).toBe('2026-11-23T00:00:00Z');
  });

  it('draws empty from anything that is not the document', () => {
    for (const bad of [null, [], 'x', 3]) {
      const data = parseClash(bad as never);
      expect(data.servers).toEqual([]);
      expect(data.alliances).toEqual([]);
      expect(data.players).toEqual([]);
      expect(data.days).toBe(7);
    }
  });
});

describe('leader and shareOfPair', () => {
  it('names the larger side, and a tie for equal figures', () => {
    expect(leader(5, 3)).toBe('ours');
    expect(leader(3, 5)).toBe('theirs');
    expect(leader(0, 0)).toBe('tie');
  });

  it('has no share when neither side has anything', () => {
    expect(shareOfPair(0, 0)).toBeNull();
    expect(shareOfPair(1, 3)).toBe(0.25);
  });
});

describe('sideOf', () => {
  it('is all zeros for a server the function did not return', () => {
    const empty = sideOf(parseClash(null), 588);
    expect(empty.server_id).toBe(588);
    expect(empty.active_players).toBe(0);
    expect(empty.median_power).toBeNull();
  });
});

describe('coverageWarning', () => {
  it('says so when the opponent has fewer alliances on the board', () => {
    const text = coverageWarning(side({ server_id: 580 }), side({ alliances_on_board: 1 }));
    expect(text).toContain('Only 1 of 588');
  });

  it('says so when most moving players have no power reading', () => {
    const text = coverageWarning(side({ server_id: 580 }), side({ no_power_reading: 5 }));
    expect(text).toContain('More than half');
  });

  it('stays quiet when both sides are as seen as each other', () => {
    expect(coverageWarning(side({ server_id: 580 }), side({}))).toBeNull();
  });
});
