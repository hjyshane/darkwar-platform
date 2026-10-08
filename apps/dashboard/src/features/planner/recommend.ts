// Which upgrade to do next (item 2): no React, no queries.
//
// POWER IN game_upgrade_steps IS POWER AT THE LEVEL, NOT POWER ADDED. Checked
// on WonderingDuck (2026-10-08): summing `power` over the steps at the levels
// the account stands on gives 85.0M for buildings and 52.0M for research,
// which are the 건축물 85M and 과학기술 51.8M the game shows; summing every
// step up to those levels gives 1.26B. So what a step ADDS is its power minus
// the power of the level below, and that is what is ranked here.
//
// Three kinds of step are kept out of the ranking, and they are different:
//   noPower  - adds exactly 0 (furniture, roads, the utility researches). Not
//              free, not good: it is skipped, never shown as a bargain.
//   unknown  - power is NULL on either level, so the gain cannot be worked out.
//   blocked  - a prerequisite is not met yet; says which.

import { type Buffs, type Requirement, type Step, totals } from './plan';

/** A step and the one below it, which is where the account stands. `current`
 * is null for something not built or researched yet (power 0 by definition). */
export interface StepPair {
  /** Only its power is read, so a row that carries nothing else will do. */
  current: { power?: number | null } | null;
  next: Step;
}

export type Metric = 'perHour' | 'perStock';

export interface Stock {
  resources: Readonly<Record<string, number>>;
  items: Readonly<Record<string, number>>;
}

export interface Candidate extends StepPair {
  step: Step;
  /** Power the step adds; null when it cannot be told. */
  gain: number | null;
  blockedBy: Requirement[];
}

export interface Recommendation {
  step: Step;
  gain: number;
  /** After the speed buff; null when the step takes no time. */
  hours: number | null;
  /** What it costs after the cost-reduction buff. */
  costs: { type: 'resource' | 'item'; id: string; amount: number }[];
  /** The largest share of any single stock the step would use; 0 for no cost. */
  worstShare: number;
  affordable: boolean;
  score: number;
}

export interface Recommendations {
  ranked: Recommendation[];
  noPower: Candidate[];
  unknown: Candidate[];
  blocked: Candidate[];
}

export interface RecommendInput {
  pairs: ReadonlyArray<StepPair>;
  buildings: ReadonlyMap<string, number>;
  research: ReadonlyMap<string, number>;
  stock: Stock;
  buffs: Buffs;
  metric: Metric;
}

function gainOf({ current, next }: StepPair): number | null {
  if (next.power === null || next.power === undefined) {
    return null;
  }
  if (current === null) {
    return next.power;
  }
  if (current.power === null || current.power === undefined) {
    return null;
  }
  return next.power - current.power;
}

function unmet(step: Step, input: RecommendInput): Requirement[] {
  return step.requires.filter((need) => {
    const have =
      (need.kind === 'research' ? input.research : input.buildings).get(need.subject) ?? 0;
    return have < need.level;
  });
}

function shareOf(cost: { type: 'resource' | 'item'; id: string; amount: number }, stock: Stock) {
  const held = (cost.type === 'resource' ? stock.resources : stock.items)[cost.id] ?? 0;
  if (cost.amount <= 0) {
    return 0;
  }
  return held <= 0 ? Number.POSITIVE_INFINITY : cost.amount / held;
}

function price(candidate: Candidate, gain: number, input: RecommendInput): Recommendation {
  const { step } = candidate;
  const spent = totals([{ step, prerequisite: false, goal: 0 }], input.buffs);
  const seconds = step.kind === 'building' ? spent.buildSeconds : spent.researchSeconds;
  const hours = seconds > 0 ? seconds / 3600 : null;
  const worstShare = Math.max(0, ...spent.materials.map((cost) => shareOf(cost, input.stock)));
  const affordable = worstShare <= 1;
  const score =
    input.metric === 'perHour'
      ? hours === null
        ? Number.POSITIVE_INFINITY
        : gain / hours
      : worstShare === 0
        ? Number.POSITIVE_INFINITY
        : gain / worstShare;
  return { step, gain, hours, costs: spent.materials, worstShare, affordable, score };
}

/** Descending by score; two infinities (or two equal scores) fall back to the
 * bigger gain, because Infinity - Infinity is NaN and would scramble the sort. */
function byScore(a: Recommendation, b: Recommendation): number {
  if (a.score !== b.score) {
    return a.score > b.score ? -1 : 1;
  }
  return b.gain - a.gain;
}

export function recommend(input: RecommendInput): Recommendations {
  const out: Recommendations = { ranked: [], noPower: [], unknown: [], blocked: [] };
  for (const pair of input.pairs) {
    const candidate: Candidate = {
      ...pair,
      step: pair.next,
      gain: gainOf(pair),
      blockedBy: unmet(pair.next, input),
    };
    if (candidate.blockedBy.length > 0) {
      out.blocked.push(candidate);
    } else if (candidate.gain === null) {
      out.unknown.push(candidate);
    } else if (candidate.gain <= 0) {
      out.noPower.push(candidate);
    } else {
      out.ranked.push(price(candidate, candidate.gain, input));
    }
  }
  out.ranked.sort((a, b) =>
    input.metric === 'perStock' && a.affordable !== b.affordable
      ? a.affordable
        ? -1
        : 1
      : byScore(a, b),
  );
  return out;
}
