import { describe, expect, test } from 'vitest';
import type { PackValue } from './data';
import { shopStrip } from './strip';

const NOW = new Date('2026-10-10T12:00:00Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

const pack = (over: Partial<PackValue> = {}): PackValue => ({
  server_id: 580,
  pack_id: 'p1',
  name_key: null,
  name: 'Starter',
  game_name: 'Starter',
  renamed: false,
  name_ko: null,
  dollars: 5,
  rubies: 500,
  claimed_percent: null,
  starts_at: at(-24),
  ends_at: at(24),
  captured_at: at(-1),
  item_rubies: 0,
  unvalued_items: 0,
  contents: [],
  value_dollars: 10,
  value_ratio: 2,
  contents_listed: true,
  listed: true,
  ...over,
});

const cell = (packs: PackValue[], label: string) =>
  shopStrip(packs, NOW).find((entry) => entry.label === label);

describe('shopStrip', () => {
  test('counts the offers on sale now, not those that ended or have not started', () => {
    const packs = [
      pack(),
      pack({ pack_id: 'p2', game_name: 'B', name: 'B' }),
      pack({ pack_id: 'p3', game_name: 'C', name: 'C', ends_at: at(-1) }),
      pack({ pack_id: 'p4', game_name: 'D', name: 'D', starts_at: at(5) }),
      pack({ pack_id: 'p5', game_name: 'E', name: 'E', listed: false }),
    ];

    expect(cell(packs, 'On sale now')).toMatchObject({ value: '2', note: 'offers' });
  });

  test('an offer issued under several ids counts once', () => {
    expect(cell([pack(), pack({ pack_id: 'p2' })], 'On sale now')?.value).toBe('1');
  });

  test('names the best value, and is not fooled by a pack with no ratio', () => {
    const packs = [
      pack({ pack_id: 'a', game_name: 'Ok', name: 'Ok', value_ratio: 2 }),
      pack({ pack_id: 'b', game_name: 'Great', name: 'Great', value_ratio: 3.4, dollars: 10 }),
      pack({ pack_id: 'c', game_name: 'Pass', name: 'Pass', value_ratio: null }),
    ];

    expect(cell(packs, 'Best value')).toMatchObject({ value: 'Great', note: '×3.4 for $10' });
  });

  test('names the offer that ends first', () => {
    const packs = [
      pack({ pack_id: 'a', game_name: 'Late', name: 'Late', ends_at: at(48) }),
      pack({ pack_id: 'b', game_name: 'Soon', name: 'Soon', ends_at: at(5) }),
      pack({ pack_id: 'c', game_name: 'Open', name: 'Open', ends_at: null }),
    ];

    expect(cell(packs, 'Ends next')).toMatchObject({ value: 'Soon', note: 'in 5 h' });
  });

  test('averages only the offers that have a ratio', () => {
    const packs = [
      pack({ pack_id: 'a', game_name: 'A', name: 'A', value_ratio: 2 }),
      pack({ pack_id: 'b', game_name: 'B', name: 'B', value_ratio: 4 }),
      pack({ pack_id: 'c', game_name: 'C', name: 'C', value_ratio: null }),
    ];

    expect(cell(packs, 'Average value')).toMatchObject({
      value: '×3.0',
      note: 'over 2 with a ratio',
    });
  });

  test('has no best, ending or average with nothing on sale, and says zero', () => {
    const none = [pack({ ends_at: at(-1) })];

    expect(cell(none, 'On sale now')?.value).toBe('0');
    expect(cell(none, 'Best value')?.value).toBeNull();
    expect(cell(none, 'Ends next')?.value).toBeNull();
    expect(cell(none, 'Average value')?.value).toBeNull();
  });
});
