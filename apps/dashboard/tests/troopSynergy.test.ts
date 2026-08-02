import { expect, test } from 'vitest';
import { BEATS, type LineupHero, synergy, synergyLabel, troopClassName } from '../src/lib/troops';

function lineup(classes: (number | null)[]): LineupHero[] {
  return classes.map((troop_class, index) => ({
    slot: index + 1,
    hero_id: 1000 + index,
    troop_class,
    hero_level: 100,
    level_synced: false,
    star: 6,
    hero_power: 1,
    weapon_level: null,
    skills: [],
    equipment: [],
  }));
}

test('the counter cycle has no way out', () => {
  // Shooter beats Fighter beats Rider beats Shooter. Every class is both an
  // answer and a problem, so no lineup is unconditionally safe.
  expect(BEATS[2]).toBe(1);
  expect(BEATS[1]).toBe(3);
  expect(BEATS[3]).toBe(2);
  const targets = Object.values(BEATS).sort();
  expect(targets).toEqual([1, 2, 3]);
});

test('three of a class is where the bonus starts', () => {
  expect(synergy(lineup([2, 2, 1, 1, 3]))).toBeNull();
  const three = synergy(lineup([2, 2, 2, 1, 3]));
  expect(three?.count).toBe(3);
  expect(three?.statMultiplier).toBe(1.15);
  expect(three?.counterDamageBonus).toBe(0.21);
});

test("the steps are the game's, and they are not linear", () => {
  expect(synergy(lineup([2, 2, 2, 2, 1]))?.statMultiplier).toBe(1.25);
  expect(synergy(lineup([2, 2, 2, 2, 1]))?.counterDamageBonus).toBe(0.36);
  expect(synergy(lineup([3, 3, 3, 3, 3]))?.statMultiplier).toBe(1.35);
  expect(synergy(lineup([3, 3, 3, 3, 3]))?.counterDamageBonus).toBe(0.5);
});

test('no bonus is null, never a multiplier of one', () => {
  // 1.0 and "no bonus" render identically and mean different things — one is
  // a rule that applied and did nothing, the other is a rule that did not
  // apply. Same reason every unknown in this app is null rather than zero.
  expect(synergy(lineup([1, 2, 3, 1, 2]))).toBeNull();
  expect(synergy([])).toBeNull();
});

test('a lineup of five can only ever have one bonus', () => {
  // Two classes cannot both reach three out of five, so the caller never has
  // to choose between two bonuses — which is why this returns one, not a list.
  for (const classes of [
    [1, 1, 1, 2, 2],
    [2, 2, 2, 3, 3],
    [3, 3, 3, 1, 1],
  ]) {
    const found = synergy(lineup(classes));
    expect(found).not.toBeNull();
    expect(found?.count).toBe(3);
  }
});

test('an unobserved class counts toward nothing', () => {
  // A null class is unknown, not a fourth class. Counting nulls together
  // would invent a bonus out of missing data.
  expect(synergy(lineup([null, null, null, 1, 2]))).toBeNull();
  expect(synergy(lineup([2, 2, null, null, null]))).toBeNull();
  // And the real ones still count when nulls are present.
  expect(synergy(lineup([2, 2, 2, null, null]))?.count).toBe(3);
});

test('a class outside the cycle earns no stated bonus', () => {
  // A fourth class would be news (troops.ts says so). Until it is in BEATS
  // there is nothing true to say about what it beats, so nothing is claimed.
  expect(synergy(lineup([9, 9, 9, 1, 2]))).toBeNull();
});

test('the label says what it is and what it costs', () => {
  const value = synergy(lineup([2, 2, 2, 1, 3]));
  expect(value).not.toBeNull();
  const label = synergyLabel(value as NonNullable<typeof value>);
  expect(label).toContain('3 Shooter');
  expect(label).toContain('×1.15');
  expect(label).toContain('+21%');
  expect(label).toContain(`beats ${troopClassName(1)}`);
  expect(label).toContain(`loses to ${troopClassName(3)}`);
});
