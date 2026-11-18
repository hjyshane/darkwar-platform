import { describe, expect, test } from 'vitest';
import type { Battle } from './data';
import { blackGoldStrip } from './strip';

const battle = (over: Partial<Battle> = {}): Battle => ({
  alliance_external_id: 'x',
  battle_ended_at: '2026-10-08T12:00:00Z',
  team_index: 1,
  state: 2,
  score: 100,
  user_num: 20,
  max_user_num: 20,
  enemy_name: 'Them',
  enemy_abbr: 'TH',
  enemy_score: 50,
  enemy_user_num: 20,
  signup_read_at: null,
  starters: null,
  substitutes: null,
  players_scored: null,
  report_seen: true,
  ...over,
});

const cell = (battles: Battle[], label: string) =>
  blackGoldStrip(battles).find((entry) => entry.label === label);

describe('blackGoldStrip', () => {
  test('is empty with no battle captured', () => {
    expect(blackGoldStrip([])).toEqual([]);
  });

  test('counts wins and losses, and says how many battles are captured', () => {
    const battles = [battle(), battle({ state: 3 }), battle({ state: 2 })];

    expect(cell(battles, 'Record')).toMatchObject({
      value: '2 – 1',
      note: '3 battles captured',
    });
  });

  test('a battle with no result is neither a win nor a loss, and the note says so', () => {
    const battles = [battle(), battle({ state: null })];

    expect(cell(battles, 'Record')).toMatchObject({
      value: '1 – 0',
      note: '2 captured, 1 with no result yet',
    });
    expect(cell(battles, 'Win rate')).toMatchObject({ value: '100%', note: 'of 1 with a result' });
  });

  test('has no win rate while no result is known', () => {
    expect(cell([battle({ state: null })], 'Win rate')?.value).toBeNull();
  });

  test('names the newest battle, its result, its day and team', () => {
    const battles = [
      battle({ battle_ended_at: '2026-10-07T12:00:00Z', state: 3 }),
      battle({ battle_ended_at: '2026-10-08T12:00:00Z', state: 2, team_index: 2 }),
    ];

    expect(cell(battles, 'Latest')).toMatchObject({ value: 'Win', note: '2026-10-08 · Team B' });
  });

  test('counts the reports that are in', () => {
    const battles = [battle(), battle({ report_seen: false }), battle({ report_seen: null })];

    expect(cell(battles, 'Reports in')?.value).toBe('1 of 3');
  });
});
