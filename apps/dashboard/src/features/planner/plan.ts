// The material planner's arithmetic (item 4): no React, no queries.
//
// Every step in game_upgrade_steps is stored by the LEVEL IT REACHES (0220):
// going from 30 to 35 is the steps at 31..35. Buildings carry the other
// buildings they need (`requires`); planning a building pulls those in too,
// as far as they fall short, and the plan's own earlier steps count — a
// Watchtower goal that needs Alliance Hall 35 and an Alliance Hall goal to 40
// are one Alliance Hall climb, not two.
//
// Buffs follow the game (verified on the user's own table, 2026-10-03):
// time = base / (1 + speed%), resources = base x (1 - cost reduction%).
// Construction speed and cost reduction act on buildings, research speed on
// research; hero levels and gear have no time and no discount.

export type Kind = 'building' | 'research' | 'hero' | 'hero_gear' | 'exclusive';

export interface Cost {
  type: 'resource' | 'item';
  id: string;
  amount: number;
}

export interface Requirement {
  subject: string;
  level: number;
}

export interface Step {
  kind: Kind;
  subject_id: string;
  level: number;
  name: string | null;
  costs: Cost[];
  seconds: number | null;
  requires: Requirement[];
}

export interface Goal {
  kind: Kind;
  subject: string;
  /** Current level; the plan adds the steps above it. */
  from: number;
  to: number;
}

export interface Buffs {
  /** Percent, as the game shows them: 156.16 means +156.16%. */
  constructionSpeed: number;
  researchSpeed: number;
  costReduction: number;
}

/** steps for one (kind, subject), keyed by the level each reaches. */
export type StepBook = Map<string, Map<number, Step>>;

export function bookKey(kind: Kind, subject: string): string {
  return `${kind}:${subject}`;
}

export interface PlannedStep {
  step: Step;
  /** True when no goal asked for it: a prerequisite the plan pulled in. */
  prerequisite: boolean;
  /** Index of the goal that asked for it, or of the goal whose step needed
   * it when it is a prerequisite. */
  goal: number;
}

export interface Plan {
  steps: PlannedStep[];
  /** Buildings a requirement names whose steps are not loaded yet. The
   * caller loads them and plans again; empty when the plan is complete. */
  missing: string[];
  /** Goals or prerequisites with no step for some level in their range —
   * past the game's maximum, or a subject the catalogue does not know. */
  gaps: { kind: Kind; subject: string; level: number }[];
}

/** The steps for every goal, building prerequisites included.
 *
 * `levels` is the account's current building levels (type x 1000 -> level);
 * the plan raises them as it goes, so a prerequisite already met — or met by
 * an earlier step of the plan — is not added again. */
export function plan(
  goals: ReadonlyArray<Goal>,
  book: StepBook,
  levels: ReadonlyMap<string, number>,
  withPrerequisites = true,
): Plan {
  const reached = new Map(levels);
  const steps: PlannedStep[] = [];
  const missing = new Set<string>();
  const gaps: Plan['gaps'] = [];

  const climb = (
    kind: Kind,
    subject: string,
    from: number,
    to: number,
    prerequisite: boolean,
    depth: number,
    goal: number,
  ) => {
    const known = book.get(bookKey(kind, subject));
    if (known === undefined) {
      if (kind === 'building') {
        missing.add(subject);
      } else {
        gaps.push({ kind, subject, level: from + 1 });
      }
      return;
    }
    for (let level = from + 1; level <= to; level += 1) {
      const step = known.get(level);
      if (step === undefined) {
        gaps.push({ kind, subject, level });
        return;
      }
      if (kind === 'building' && withPrerequisites && depth < 50) {
        for (const need of step.requires) {
          const have = reached.get(need.subject) ?? 0;
          if (have < need.level) {
            climb('building', need.subject, have, need.level, true, depth + 1, goal);
          }
        }
      }
      steps.push({ step, prerequisite, goal });
      if (kind === 'building') {
        reached.set(subject, Math.max(reached.get(subject) ?? 0, level));
      }
    }
  };

  goals.forEach((goal, index) => {
    const from =
      goal.kind === 'building' ? Math.max(goal.from, reached.get(goal.subject) ?? 0) : goal.from;
    climb(goal.kind, goal.subject, from, goal.to, false, 0, index);
  });
  return { steps, missing: [...missing].sort(), gaps };
}

export interface MaterialTotal {
  type: 'resource' | 'item';
  id: string;
  amount: number;
}

export interface Totals {
  materials: MaterialTotal[];
  /** Seconds after buffs, by what they are spent on. */
  buildSeconds: number;
  researchSeconds: number;
}

/** What a plan costs after buffs. Construction cost reduction applies to the
 * resources a building step takes, not to items like Precision Parts. */
export function totals(steps: ReadonlyArray<PlannedStep>, buffs: Buffs): Totals {
  const sums = new Map<string, MaterialTotal>();
  let buildSeconds = 0;
  let researchSeconds = 0;
  for (const { step } of steps) {
    for (const cost of step.costs) {
      const discounted =
        step.kind === 'building' && cost.type === 'resource'
          ? cost.amount * (1 - buffs.costReduction / 100)
          : cost.amount;
      const key = `${cost.type}:${cost.id}`;
      const held = sums.get(key);
      sums.set(key, { type: cost.type, id: cost.id, amount: (held?.amount ?? 0) + discounted });
    }
    if (step.seconds !== null) {
      if (step.kind === 'building') {
        buildSeconds += step.seconds / (1 + buffs.constructionSpeed / 100);
      } else if (step.kind === 'research') {
        researchSeconds += step.seconds / (1 + buffs.researchSpeed / 100);
      }
    }
  }
  const materials = [...sums.values()]
    .map((m) => ({ ...m, amount: Math.round(m.amount) }))
    .sort((a, b) => b.amount - a.amount);
  return {
    materials,
    buildSeconds: Math.round(buildSeconds),
    researchSeconds: Math.round(researchSeconds),
  };
}

/** "3d 2h", "5h 12m", "40m". Past a day, to the nearest hour, as the game
 * shows it: 4d 14h 34m reads 4d 15h. */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 1440) {
    const hours = Math.round(minutes / 60);
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/** Buffs from the account's login (0219): the server's summed totals, plus
 * any timed buff on the same effect the reader switches on. */
export const EFFECT_IDS = {
  constructionSpeed: '30070',
  researchSpeed: '30071',
  costReduction: '30421',
} as const;

export function buffsFrom(
  effects: Readonly<Record<string, number>>,
  timed: ReadonlyArray<{ effect: number; value: number }> = [],
): Buffs {
  const add = (id: string) =>
    (effects[id] ?? 0) +
    timed.filter((t) => String(t.effect) === id).reduce((s, t) => s + t.value, 0);
  return {
    constructionSpeed: round2(add(EFFECT_IDS.constructionSpeed)),
    researchSpeed: round2(add(EFFECT_IDS.researchSpeed)),
    costReduction: round2(add(EFFECT_IDS.costReduction)),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface StepGroup {
  /** `goal:<index>` for what a goal asked for, `pre:<subject>` for a
   * building pulled in first. */
  key: string;
  goal: number;
  prerequisite: boolean;
  kind: Kind;
  subject: string;
  name: string | null;
  /** The level before the first step, and the highest level reached. */
  from: number;
  to: number;
  steps: PlannedStep[];
}

/** A plan split the way "What it takes" shows it: one group per goal, and
 * one per building a goal needed first, in the order they are first met.
 * Two gear pieces of one quality share a cost list (subject) but stay two
 * groups, because they are two goals. */
export function groupSteps(steps: ReadonlyArray<PlannedStep>): StepGroup[] {
  const groups = new Map<string, StepGroup>();
  for (const planned of steps) {
    const { step, prerequisite, goal } = planned;
    const key = prerequisite ? `pre:${step.subject_id}` : `goal:${goal}`;
    const held = groups.get(key);
    if (held) {
      held.steps.push(planned);
      held.from = Math.min(held.from, step.level - 1);
      held.to = Math.max(held.to, step.level);
      held.name = held.name ?? step.name;
    } else {
      groups.set(key, {
        key,
        goal,
        prerequisite,
        kind: step.kind,
        subject: step.subject_id,
        name: step.name,
        from: step.level - 1,
        to: step.level,
        steps: [planned],
      });
    }
  }
  return [...groups.values()];
}
