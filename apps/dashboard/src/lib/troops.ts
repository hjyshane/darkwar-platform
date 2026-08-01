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
  /** The hero's level, not the cap — the blob carries both and the cap is
   * 200 for everyone. */
  hero_level: number | null;
  star: number | null;
  hero_power: number | null;
  /** Null means the exclusive weapon is not unlocked, which is a state, not
   * a zero. */
  weapon_level: number | null;
  skills: LineupSkill[];
  equipment: LineupEquipment[];
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
