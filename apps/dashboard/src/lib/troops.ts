/** Troop classes, as `arena_entry_heroes.troop_class` stores them.
 *
 * The payload only ever gives the number. The labels were read off the game
 * screen and cross-checked against the collector's own lineup, so they live
 * here as a translation rather than being baked into the schema — same
 * reasoning as TERMS. A number we have not seen before renders as itself
 * instead of guessing, because a fourth class would be news.
 */
export const TROOP_CLASSES: Record<number, string> = {
  1: 'Fighter',
  2: 'Shooter',
  3: 'Rider',
};

export interface LineupSkill {
  skill_id: number;
  level: number | null;
}

export interface LineupEquipment {
  equipment_id: number;
  level: number | null;
  step: number | null;
}

export interface LineupHero {
  slot: number | null;
  hero_id: number;
  troop_class: number | null;
  /** The hero's actual level. A training-centre hero is genuinely raised to
   * this level, so it is the real figure either way. */
  hero_level: number | null;
  /** Whether the level comes from the training centre. Recorded because the
   * payload distinguishes them, not because the level is worth less. */
  level_synced: boolean;
  star: number | null;
  hero_power: number | null;
  /** Null means the exclusive weapon is not unlocked, which is a state, not
   * a zero. */
  weapon_level: number | null;
  skills: LineupSkill[];
  equipment: LineupEquipment[];
}

/** Stars as the game prints them. The payload counts one higher.
 *
 * `arena_entry_heroes.star` keeps the observed number, which is right — the
 * database records what arrived. But 5★ is the cap in game and the payload's
 * top value is 6, so showing it unconverted put a sixth star on 2,196 of the
 * 4,260 decoded heroes. The offset is not a guess: init.userHero carries a
 * `stage` field on exactly the heroes below payload 6 and on none of the
 * ones at it, which is the boundary the game draws at maximum stars.
 *
 * Below 1 there is nothing sensible to print, so an unexpected value passes
 * through rather than becoming a negative star count.
 */
export function starsShown(star: number | null): number | null {
  if (star === null) {
    return null;
  }
  return star >= 1 ? star - 1 : star;
}

export function troopClassName(value: number | null): string {
  if (value === null) {
    return 'Unknown';
  }
  return TROOP_CLASSES[value] ?? `Class ${value}`;
}

/** One letter for the chip. Two classes starting with the same letter would
 * make this useless, which is why it is derived from the label rather than
 * hard-coded per id — a new class shows up as its own initial. */
export function troopClassInitial(value: number | null): string {
  return value === null ? '?' : troopClassName(value).charAt(0);
}

/** "3 Shooter · 1 Fighter · 1 Rider", most common first.
 *
 * This is the line people actually compare opponents by, and it is what makes
 * the lineup searchable — typing "shooter" finds the teams built around them.
 */
export function composition(heroes: readonly LineupHero[]): string {
  if (heroes.length === 0) {
    return '';
  }
  const counts = new Map<number | null, number>();
  for (const hero of heroes) {
    counts.set(hero.troop_class, (counts.get(hero.troop_class) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] || troopClassName(left[0]).localeCompare(troopClassName(right[0])),
    )
    .map(([value, count]) => `${count} ${troopClassName(value)}`)
    .join(' · ');
}

/** Slot order, with unknown slots last so a lineup missing one still renders
 * all five rather than dropping the odd hero out. */
export function bySlot(heroes: readonly LineupHero[]): LineupHero[] {
  return [...heroes].sort((left, right) => (left.slot ?? 99) - (right.slot ?? 99));
}

/** What each class is strong against.
 *
 * Shooter beats Fighter, Fighter beats Rider, Rider beats Shooter — a cycle,
 * so every class is both someone's answer and someone's problem. Read off the
 * game by the user rather than from the payload, which carries no such thing;
 * the same standing as the class labels above.
 */
export const BEATS: Record<number, number> = {
  2: 1, // Shooter > Fighter
  1: 3, // Fighter > Rider
  3: 2, // Rider > Shooter
};

/** Stacking one class buys a bonus, and the game's steps are not linear.
 *
 * Three of a class is where it starts; there is no bonus for one or two, so
 * `synergy` returns null rather than a 1.0 multiplier — "no bonus" and "a
 * bonus of none" would render the same and mean different things.
 */
const SYNERGY_STEPS: Record<number, { stat: number; counter: number }> = {
  3: { stat: 1.15, counter: 0.21 },
  4: { stat: 1.25, counter: 0.36 },
  5: { stat: 1.35, counter: 0.5 },
};

export interface Synergy {
  troopClass: number;
  count: number;
  /** Multiplier on the heroes' attack and defence. */
  statMultiplier: number;
  /** Extra damage the soldiers deal on a counter-attack, as a fraction. */
  counterDamageBonus: number;
  /** The class this lineup is built to beat. */
  strongAgainst: number;
  /** The class built to beat this lineup. */
  weakAgainst: number;
}

/** The bonus a lineup earns, or null if no class reaches three.
 *
 * A lineup has five heroes, so at most one class can reach three — the
 * question of which of two bonuses applies cannot arise, and the type says
 * so by returning one value rather than a list.
 *
 * Heroes whose class was never observed are not counted toward anything: a
 * null class is unknown, not a fourth class, and guessing it could invent a
 * bonus that is not there.
 */
export function synergy(heroes: readonly LineupHero[]): Synergy | null {
  const counts = new Map<number, number>();
  for (const hero of heroes) {
    if (hero.troop_class !== null) {
      counts.set(hero.troop_class, (counts.get(hero.troop_class) ?? 0) + 1);
    }
  }
  for (const [troopClass, count] of counts) {
    const step = SYNERGY_STEPS[count];
    if (step === undefined) {
      continue;
    }
    const strongAgainst = BEATS[troopClass];
    const weakAgainst = Number(Object.keys(BEATS).find((key) => BEATS[Number(key)] === troopClass));
    if (strongAgainst === undefined || Number.isNaN(weakAgainst)) {
      // A class we have never seen has no place in the cycle, so it earns no
      // stated bonus even if three of them turn up.
      continue;
    }
    return {
      troopClass,
      count,
      statMultiplier: step.stat,
      counterDamageBonus: step.counter,
      strongAgainst,
      weakAgainst,
    };
  }
  return null;
}

/** "3 Shooter · ×1.15 atk/def · +21% counter · beats Fighter" */
export function synergyLabel(value: Synergy): string {
  return [
    `${value.count} ${troopClassName(value.troopClass)}`,
    `×${value.statMultiplier} atk/def`,
    `+${Math.round(value.counterDamageBonus * 100)}% counter damage`,
    `beats ${troopClassName(value.strongAgainst)}`,
    `loses to ${troopClassName(value.weakAgainst)}`,
  ].join(' · ');
}
