import { expect, test } from 'vitest';
import {
  MONSTER_CAP,
  SEASON_MONSTERS,
  SELF_FLOOR,
  panelPower,
  parsePenaltyParam,
  penalty,
  percentChange,
  powerFor,
  requiredFor,
  verdict,
} from './resistance';

// The attack panel screenshot the rule was checked against: a Lv.52 Booze
// Brute wanting 9,700 against 8,500 drew "-99.0% DMG" and "+24000.0%".
test('reproduces the game panel: 8,500 against 9,700', () => {
  const result = penalty(8500, 9700);
  expect(result.deficit).toBe(1200);
  expect(percentChange(result.self)).toBe('-99.0%');
  expect(percentChange(result.monster)).toBe('+24000.0%');
  expect(verdict(result)).toBe('defeat');
});

// The second check (owner, 2026-11-21): a Lv.60 Rotting Oni wanting 10,000
// against 9,750 drew -25% / +2108.5%, and recommended 2.6G where the table
// says 490M. The panel scales the table's power by √(monster ÷ yours).
test('reproduces the second panel: 9,750 against 10,000, and its inflated power', () => {
  const oniRow = SEASON_MONSTERS.find((m) => m.id === 'oni');
  if (oniRow === undefined) throw new Error('no oni');
  expect(requiredFor(oniRow, 60, '6')).toBe(10000);
  const result = penalty(9750, 10000);
  expect(percentChange(result.self)).toBe('-25.0%');
  expect(percentChange(result.monster)).toBe('+2108.5%');
  expect(powerFor(oniRow, 60)).toBe(489900000);
  const shown = panelPower(powerFor(oniRow, 60), result);
  expect(shown).toBeCloseTo(2659e6, -7);
});

test('the panel power is the table power while the requirement is met', () => {
  expect(panelPower(489900000, penalty(10000, 10000))).toBe(489900000);
  expect(panelPower(489900000, penalty(12000, 10000))).toBe(489900000);
  expect(panelPower(null, penalty(9750, 10000))).toBeNull();
  // The floor and cap bound it: √(300 ÷ 0.01) ≈ 173× at worst.
  expect(panelPower(1e9, penalty(0, 10000))).toBeCloseTo(1e9 * Math.sqrt(300 / 0.01), -6);
});

test('enough resistance costs nothing, however much is spare', () => {
  expect(penalty(9700, 9700)).toEqual({ deficit: 0, self: 1, monster: 1 });
  expect(penalty(20000, 9700)).toEqual({ deficit: -10300, self: 1, monster: 1 });
  expect(verdict(penalty(9700, 9700))).toBe('sufficient');
});

// Below a 400 shortfall the monster's bonus is (1 + 0.0027·d)^6; from 400 it
// is 1 + 0.2·d. The two meet at 400 (80.98 against 81), which is the point.
test('your damage falls 0.1% a point; the monster climbs on a curve that bends at 400', () => {
  expect(penalty(9600, 9700).self).toBeCloseTo(0.9);
  expect(penalty(9600, 9700).monster).toBeCloseTo(4.196, 3);
  expect(penalty(9300, 9700).monster).toBeCloseTo(80.98, 2);
  expect(penalty(9200, 9700).monster).toBe(101);
  expect(penalty(8700, 9700)).toMatchObject({ deficit: 1000, monster: 201 });
  expect(verdict(penalty(9600, 9700))).toBe('insufficient');
});

test('the floor and the cap are the server constants', () => {
  // 1 - 990/1000 = 0.01 exactly; one more point and the floor holds it.
  expect(penalty(8710, 9700).self).toBeCloseTo(SELF_FLOOR);
  expect(penalty(0, 9700).self).toBe(SELF_FLOOR);
  // 1 + 0.2·1495 = 300; past it the cap holds.
  expect(penalty(8205, 9700).monster).toBe(MONSTER_CAP);
  expect(penalty(0, 9700).monster).toBe(MONSTER_CAP);
});

test('the param string reads as two pieces, the last one open-ended', () => {
  expect(parsePenaltyParam('0.0027;1000;6;0;400|0.2;1000;1;0')).toEqual([
    { a: 0.0027, b: 1000, n: 6, c: 0, upTo: 400 },
    { a: 0.2, b: 1000, n: 1, c: 0, upTo: null },
  ]);
});

test('percentages carry the panel sign and one decimal', () => {
  expect(percentChange(1)).toBe('0.0%');
  expect(percentChange(0.7)).toBe('-30.0%');
  expect(percentChange(2.138)).toBe('+113.8%');
});

// --- the ladders ------------------------------------------------------------

const brute = SEASON_MONSTERS.find((m) => m.id === 'brute');
const oni = SEASON_MONSTERS.find((m) => m.id === 'oni');

test('every ladder runs 1-85 on both tables', () => {
  for (const monster of SEASON_MONSTERS) {
    expect(monster.required6).toHaveLength(85);
    expect(monster.required7Tail).toHaveLength(20);
    expect(monster.power).toHaveLength(85);
    expect(requiredFor(monster, 1, '6')).not.toBeNull();
    expect(requiredFor(monster, 85, '7')).not.toBeNull();
    expect(requiredFor(monster, 86, '6')).toBeNull();
    expect(requiredFor(monster, 0, '6')).toBeNull();
  }
});

test('the Lv.52 Booze Brute wants 9,700 and recommends 945.1M, as the panel showed', () => {
  if (brute === undefined) throw new Error('no brute');
  expect(requiredFor(brute, 52, '6')).toBe(9700);
  expect(requiredFor(brute, 52, '7')).toBe(9700);
  expect(powerFor(brute, 52)).toBe(945100000);
  expect(brute.rally).toBe(true);
});

// The two internal season tables agree to 65 and part at 66 (12920 against
// 12855 at 80); the page offers both because the app cannot tell which a
// server is on.
test('tables 6 and 7 agree below 66 and part above it', () => {
  if (brute === undefined || oni === undefined) throw new Error('no monsters');
  expect(requiredFor(brute, 65, '6')).toBe(requiredFor(brute, 65, '7'));
  expect(requiredFor(brute, 80, '6')).toBe(12920);
  expect(requiredFor(brute, 80, '7')).toBe(12855);
  expect(requiredFor(oni, 85, '6')).toBe(13020);
  expect(requiredFor(oni, 85, '7')).toBe(12930);
  expect(oni.rally).toBe(false);
  expect(powerFor(oni, 85)).toBe(1001000000);
});
