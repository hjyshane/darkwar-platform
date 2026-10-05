// What the reader asked for, one target per thing raised, and how targets
// become the plan's goals. No React.
//
// A target is keyed by what it raises, so picking a new level for the same
// building replaces the old target instead of adding a second climb.

import type { Goal, Kind } from './plan';

export interface Target {
  kind: Kind;
  /** building / research: subject id; hero: hero id; exclusive: hero id;
   * hero_gear: `<index in heroGear>:<equipId>:<quality>`. */
  subject: string;
  name: string;
  from: number;
  to: number;
  /** Hero gear: current and target stage (stage-up, then awakening).
   * Pet: stageFrom is the breakthrough already reached. */
  stageFrom?: number;
  stageTo?: number;
}

export function targetKey(kind: Kind, subject: string): string {
  return `${kind}:${subject}`;
}

/** Set, replace or (when it raises nothing) drop the target for one thing. */
export function withTarget(
  targets: ReadonlyMap<string, Target>,
  target: Target,
): Map<string, Target> {
  const next = new Map(targets);
  const key = targetKey(target.kind, target.subject);
  const raises = target.to > target.from || (target.stageTo ?? 0) > (target.stageFrom ?? 0);
  if (raises) next.set(key, target);
  else next.delete(key);
  return next;
}

/** The plan's goals, and for each the name of the target it came from. Hero
 * gear is two tracks — levels, then stages — so one target can be two
 * goals; every hero shares one Food cost list ("hero"). */
export function goalsOf(targets: Iterable<Target>): { goals: Goal[]; names: string[] } {
  const goals: Goal[] = [];
  const names: string[] = [];
  const add = (goal: Goal, name: string) => {
    goals.push(goal);
    names.push(name);
  };
  for (const t of targets) {
    if (t.kind === 'hero_gear') {
      const quality = t.subject.split(':')[2] ?? '0';
      if (t.to > t.from)
        add({ kind: 'hero_gear', subject: `level:q${quality}`, from: t.from, to: t.to }, t.name);
      if ((t.stageTo ?? 0) > (t.stageFrom ?? 0))
        add(
          { kind: 'hero_gear', subject: 'promote', from: t.stageFrom ?? 0, to: t.stageTo ?? 0 },
          `${t.name} (stages)`,
        );
    } else if (t.kind === 'pet') {
      // subject `<petId>:<rarity>`; the costs are the rarity's.
      const rarity = t.subject.split(':')[1] ?? '0';
      add({ kind: 'pet', subject: rarity, from: t.from, to: t.to }, t.name);
      for (const level of breakthroughsCrossed(t.from, t.to, t.stageFrom ?? 0)) {
        add(
          { kind: 'pet_break', subject: rarity, from: level - 1, to: level },
          `${t.name} (breakthrough ${level})`,
        );
      }
    } else if (t.kind === 'hero') {
      add({ kind: 'hero', subject: 'hero', from: t.from, to: t.to }, t.name);
    } else if (t.to > t.from) {
      add({ kind: t.kind, subject: t.subject, from: t.from, to: t.to }, t.name);
    }
  }
  return { goals, names };
}

/** The breakthroughs a pet needs on the way from `from` to `to`: every tenth
 * level it has to pass and has not broken through yet. Reaching a cap is
 * free; going past it is not. */
export function breakthroughsCrossed(from: number, to: number, reached: number): number[] {
  const out: number[] = [];
  for (let level = Math.ceil(Math.max(from, 1) / 10) * 10; level < to; level += 10) {
    if (level > reached) out.push(level);
  }
  return out;
}
