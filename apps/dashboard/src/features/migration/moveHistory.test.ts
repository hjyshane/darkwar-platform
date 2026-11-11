import { describe, expect, it } from 'vitest';
import { type ServerFlowRow, byOtherServer, sinceIso, splitFlow } from './moveHistory';

const row = (move_id: number, direction: string, other_server_id: number): ServerFlowRow => ({
  move_id,
  direction,
  player_id: `p${move_id}`,
  game_uid: move_id,
  player_name: null,
  home_server: 571,
  other_server_id,
  seen_at: '2026-11-03T00:00:00Z',
  last_seen_from_at: null,
  power: null,
  alliance_id: null,
  alliance_code: null,
  alliance_name: null,
});

describe('splitFlow', () => {
  it('splits by direction and keeps the read order', () => {
    const { arrived, departed } = splitFlow([
      row(3, 'in', 571),
      row(2, 'out', 575),
      row(1, 'in', 572),
    ]);
    expect(arrived.map((r) => r.move_id)).toEqual([3, 1]);
    expect(departed.map((r) => r.move_id)).toEqual([2]);
  });
});

describe('byOtherServer', () => {
  it('counts per other server, most first, ties by server', () => {
    expect(byOtherServer([row(1, 'in', 575), row(2, 'in', 571), row(3, 'in', 575)])).toEqual([
      { server: 575, count: 2 },
      { server: 571, count: 1 },
    ]);
  });
});

describe('sinceIso', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  it('leaves all time to the default', () => {
    expect(sinceIso('all', now)).toBeUndefined();
  });
  it('goes back seven or thirty days', () => {
    expect(sinceIso('7d', now)).toBe('2026-11-03T00:00:00.000Z');
    expect(sinceIso('30d', now)).toBe('2026-10-11T00:00:00.000Z');
  });
});
