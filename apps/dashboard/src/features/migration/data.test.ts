import { describe, expect, test } from 'vitest';
import {
  type MigrationFlow,
  type MigrationPerson,
  type MigrationServer,
  delta,
  filterBoard,
  flowMatrix,
  totals,
} from './data';
import { signed, trend } from './format';

function person(overrides: Partial<MigrationPerson>): MigrationPerson {
  return {
    game_uid: 1,
    player_id: 'p',
    name: 'P',
    home_server_id: 580,
    status: 'stayed',
    before_server_id: 580,
    before_power: 100,
    before_alliance: null,
    before_rank: null,
    before_at: null,
    after_server_id: 580,
    after_power: 110,
    after_alliance: null,
    after_rank: null,
    after_at: null,
    ...overrides,
  };
}

function server(overrides: Partial<MigrationServer>): MigrationServer {
  return {
    server_id: 580,
    tracked_before: 0,
    tracked_after: 0,
    stayed: 0,
    moved_out: 0,
    moved_in: 0,
    unseen_after: 0,
    appeared: 0,
    power_out: 0,
    power_in: 0,
    top_before: 0,
    top_after: 0,
    top_power_before: 0,
    top_power_after: 0,
    ...overrides,
  };
}

describe('delta', () => {
  test('is unknown, not zero, when either side was not observed', () => {
    expect(delta(null, 5)).toBeNull();
    expect(delta(5, null)).toBeNull();
  });

  test('is after minus before', () => {
    expect(delta(10, 7)).toBe(-3);
  });
});

describe('signed', () => {
  test('marks both directions and leaves no change unsigned', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-3)).toBe('−3');
    expect(signed(0)).toBe('0');
    expect(signed(null)).toBe('—');
  });

  test('colours only a real change', () => {
    expect(trend(2)).toBe('growth-up');
    expect(trend(-2)).toBe('growth-down');
    expect(trend(0)).toBe('');
    expect(trend(null)).toBe('');
  });
});

describe('flowMatrix', () => {
  const flows: MigrationFlow[] = [
    { from_server_id: 582, to_server_id: 580, movers: 2, top_movers: 0, power: 10 },
    { from_server_id: 580, to_server_id: 581, movers: 1, top_movers: 1, power: 5 },
  ];

  test('spans every server on either end, sorted', () => {
    expect(flowMatrix(flows).servers).toEqual([580, 581, 582]);
  });

  test('finds a route by direction, not by pair', () => {
    const { cell } = flowMatrix(flows);
    expect(cell(582, 580)?.movers).toBe(2);
    expect(cell(580, 582)).toBeUndefined();
  });
});

describe('totals', () => {
  test('counts each move once, from the side it left', () => {
    const t = totals([
      server({ server_id: 580, moved_out: 2, power_out: 30, stayed: 1 }),
      server({ server_id: 581, moved_in: 2, power_in: 31, appeared: 1 }),
    ]);
    expect(t).toEqual({ moved: 2, stayed: 1, unseen: 0, appeared: 1, powerMoved: 30 });
  });
});

describe('filterBoard', () => {
  const board = [
    person({ game_uid: 3, status: 'appeared', before_rank: null, after_rank: 2 }),
    person({ game_uid: 1, status: 'moved', before_rank: 5, after_rank: 1 }),
    person({ game_uid: 2, status: 'stayed', before_rank: 1, after_rank: 3 }),
  ];

  test('orders by rank before, newcomers last by rank after', () => {
    expect(filterBoard(board, 'all').map((p) => p.game_uid)).toEqual([2, 1, 3]);
  });

  test('filters by status without touching the input', () => {
    expect(filterBoard(board, 'moved').map((p) => p.game_uid)).toEqual([1]);
    expect(board.map((p) => p.game_uid)).toEqual([3, 1, 2]);
  });
});
