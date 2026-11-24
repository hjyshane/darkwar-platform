// What the calculator page works out from its address, with no React and no
// queries: which goals to price, which buffs apply, how a level reads, the
// step table's rows, and the notes under the totals.
//
// Nothing here computes a cost. Goals go to the planner's own plan() and
// every figure comes back out of its totals(), so the reference page cannot
// drift from the planner (the spec's first anti-goal).

import { type Translate, english } from '../../lib/i18n/core';
import { weaponSegments, weaponText } from '../planner/RankGlyphs';
import { exact, short } from '../planner/format';
import { type Tiers, levelText } from '../planner/levels';
import {
  type Buffs,
  type Goal,
  type Kind,
  type MaterialTotal,
  type PlannedStep,
  type Totals,
  groupSteps,
  totals,
} from '../planner/plan';
import { breakthroughsCrossed } from '../planner/targets';
import { CHIP_DUPLICATE_PREFIX, CHIP_EXP, chipLabel } from './chips';
import type { CalculatorKind, CalculatorState } from './url';

/** The form's kinds: the address's, plus "Season building", which is a way
 * of finding a building and not a kind of its own. */
export type FormKind = CalculatorKind | 'season';

export const KIND_OPTIONS: ReadonlyArray<{ id: FormKind; label: string }> = [
  { id: 'building', label: 'Building' },
  { id: 'research', label: 'Research' },
  { id: 'hero', label: 'Hero' },
  { id: 'hero_gear', label: 'Hero gear' },
  { id: 'exclusive', label: 'Exclusive weapon' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'vehicle_part', label: 'Vehicle part' },
  { id: 'chip', label: 'Chip' },
  { id: 'pet', label: 'Pet' },
  { id: 'season', label: 'Season building' },
];

/** The kinds offered as one entry because every subject costs the same
 * (data.ts sharedSubject). A link that names one of them by its old id — a
 * single part, a single weapon — opens that entry. */
export const SHARED_KINDS: ReadonlySet<CalculatorKind> = new Set(['vehicle_part', 'exclusive']);

/** Which buff fields a kind shows: exactly the ones plan.ts applies to it.
 * Construction speed and cost reduction act on buildings, research speed on
 * research, and nothing else has a time or a discount. */
export function buffFields(kind: CalculatorKind): { speed: boolean; cost: boolean } {
  return { speed: kind === 'building' || kind === 'research', cost: kind === 'building' };
}

/** The state with the buffs its kind does not use set to zero, so the
 * address never carries a value that changes nothing. */
export function withoutInertBuffs(state: CalculatorState): CalculatorState {
  const fields = buffFields(state.kind);
  return {
    ...state,
    speed: fields.speed ? state.speed : 0,
    cost: fields.cost ? state.cost : 0,
    prereqs: hasPrerequisites(state.kind) && state.prereqs,
  };
}

/** The kinds that need other things first: a building needs buildings, a
 * research needs buildings and earlier research (0243). Nothing else does. */
export function hasPrerequisites(kind: CalculatorKind): boolean {
  return kind === 'building' || kind === 'research';
}

/** The lowest `from` a kind allows. A hero, the vehicle and a pet exist at
 * level 1 and their first step reaches 2; everything else starts unbuilt. */
export function levelFloor(kind: CalculatorKind): number {
  return kind === 'hero' || kind === 'vehicle' || kind === 'pet' ? 1 : 0;
}

/** The planner goals a state asks for. A pet range also takes the
 * breakthroughs it passes, as the planner's own pet target does; the
 * reference assumes none has been done yet. */
export function goalsFor(state: CalculatorState): Goal[] {
  if (state.subject === null || state.to <= state.from) return [];
  const goal: Goal = {
    kind: state.kind,
    subject: state.subject,
    from: state.from,
    to: state.to,
  };
  if (state.kind !== 'pet') return [goal];
  const subject = state.subject;
  return [
    goal,
    ...breakthroughsCrossed(state.from, state.to, 0).map(
      (level): Goal => ({ kind: 'pet_break', subject, from: level - 1, to: level }),
    ),
  ];
}

/** One speed figure, on the clock the kind runs on and no other: a research
 * priced with the buildings it needs first has both clocks in it, and a
 * research speed bonus does not build anything faster. */
export function buffsFor(state: Pick<CalculatorState, 'kind' | 'speed' | 'cost'>): Buffs {
  return {
    constructionSpeed: state.kind === 'research' ? 0 : state.speed,
    researchSpeed: state.kind === 'building' ? 0 : state.speed,
    costReduction: state.cost,
  };
}

/** A level as the game shows it for that kind: a tier for a tall building, a
 * rank for an exclusive weapon, star and sub-step for a chip. */
export function levelName(
  kind: CalculatorKind,
  subject: string,
  level: number,
  tiers: Tiers,
  t: Translate = english,
): string {
  if (kind === 'building') return level === 0 ? t('Not built') : levelText(tiers, subject, level);
  if (kind === 'exclusive') return weaponText(level);
  if (kind === 'chip') return chipLabel(level);
  return String(level);
}

export interface StepRow {
  key: string;
  kind: Kind;
  subject: string;
  /** The level the step reaches; null on the total row. */
  level: number | null;
  /** `${type}:${id}` → amount after buffs. */
  amounts: ReadonlyMap<string, number>;
  /** Seconds after buffs; zero where the kind has no time. */
  seconds: number;
  /** Set on a row that is a whole climb and not one step: a building or
   * research the range needs first, from the level it is taken to stand at. */
  climb?: {
    name: string;
    /** The least it can stand at: what the range's from level required. */
    floor: number;
    /** Where it is taken to stand: the floor, or what the reader has. */
    from: number;
    to: number;
  };
}

export interface StepTableModel {
  /** The materials the range takes, largest first: the table's columns. */
  materials: MaterialTotal[];
  rows: StepRow[];
  total: StepRow;
}

export function materialKey(material: Pick<MaterialTotal, 'type' | 'id'>): string {
  return `${material.type}:${material.id}`;
}

function rowOf(sums: Totals): Pick<StepRow, 'amounts' | 'seconds'> {
  return {
    amounts: new Map(sums.materials.map((m) => [materialKey(m), m.amount])),
    seconds: sums.buildSeconds + sums.researchSeconds,
  };
}

/** One row per step and a total row, every figure from the planner's
 * totals(). Rows are priced one at a time, so a row's rounding is its own
 * and the total row is the range's, as the planner shows it. */
export function stepTable(
  steps: ReadonlyArray<PlannedStep>,
  buffs: Buffs,
  columns?: MaterialTotal[],
): StepTableModel {
  const sums = totals(steps, buffs);
  return {
    materials: columns ?? sums.materials,
    rows: steps.map((planned) => ({
      key: `${planned.step.kind}:${planned.step.subject_id}:${planned.step.level}`,
      kind: planned.step.kind,
      subject: planned.step.subject_id,
      level: planned.step.level,
      ...rowOf(totals([planned], buffs)),
    })),
    total: {
      key: 'total',
      kind: steps[0]?.step.kind ?? 'building',
      subject: '',
      level: null,
      ...rowOf(sums),
    },
  };
}

export interface PlanTables {
  /** Everything: the range and what it needs first. Its materials are the
   * columns of both tables below, so a figure is found in the same place. */
  all: StepTableModel;
  /** The range's own steps, one row each. */
  own: StepTableModel;
  /** One row per building or research needed first, in the order the plan
   * meets them; null when the range needs nothing it does not already have. */
  needed: StepTableModel | null;
}

/** A plan split for the page: the range step by step, and each thing it needs
 * first as one row. Without prerequisites in the steps, `own` is `all`.
 *
 * `floor` is the same plan before the reader said what they have. Its rows
 * are the ones listed, so a row whose level was raised until it costs nothing
 * stays where it can be lowered again; the figures are `steps`' own. */
export function planTables(
  steps: ReadonlyArray<PlannedStep>,
  buffs: Buffs,
  floor: ReadonlyArray<PlannedStep> = steps,
): PlanTables {
  const all = stepTable(steps, buffs);
  const listed = groupSteps(floor.filter((s) => s.prerequisite));
  if (listed.length === 0) return { all, own: all, needed: null };
  const first = steps.filter((s) => s.prerequisite);
  const now = new Map(groupSteps(first).map((group) => [group.key, group]));
  const own = stepTable(
    steps.filter((s) => !s.prerequisite),
    buffs,
    all.materials,
  );
  return {
    all,
    own,
    needed: {
      materials: all.materials,
      rows: listed.map((group) => {
        const left = now.get(group.key);
        return {
          key: group.key,
          kind: group.kind,
          subject: group.subject,
          level: group.to,
          ...rowOf(totals(left?.steps ?? [], buffs)),
          climb: {
            name:
              group.name ??
              `${group.kind === 'research' ? 'Research' : 'Building'} ${group.subject}`,
            floor: group.from,
            // Nothing left of it: it stands where it was needed, or past it.
            from: left?.from ?? group.to,
            to: group.to,
          },
        };
      }),
      total: {
        key: 'total',
        kind: 'building',
        subject: '',
        level: null,
        ...rowOf(totals(first, buffs)),
      },
    },
  };
}

/** A Chip Star-Up EXP Card: what one is worth, from game_items.counter_value. */
export interface ExpCard {
  itemId: string;
  name: string;
  amount: number;
}

/** Facts the totals imply, one line each, for under the totals. */
export function notesFor(
  state: CalculatorState,
  sums: Totals,
  cards: ReadonlyArray<ExpCard>,
  t: Translate = english,
): string[] {
  const notes: string[] = [];
  if (state.kind === 'chip') {
    const exp = sums.materials.find((m) => m.type === 'counter' && m.id === CHIP_EXP)?.amount ?? 0;
    const duplicates = sums.materials
      .filter((m) => m.type === 'counter' && m.id.startsWith(CHIP_DUPLICATE_PREFIX))
      .reduce((sum, m) => sum + m.amount, 0);
    if (exp > 0) {
      // The largest card that has a value: the conversion is data, so a
      // catalogue without card values states the EXP and converts nothing.
      const card = [...cards].filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount)[0];
      notes.push(
        card === undefined
          ? t('{amount} star-up EXP', { amount: short(exp) })
          : t('{amount} EXP = {cards} × {card} ({each} each)', {
              amount: short(exp),
              cards: exact(Math.ceil(exp / card.amount)),
              card: card.name,
              each: exact(card.amount),
            }),
      );
    }
    if (duplicates > 0) {
      notes.push(
        duplicates === 1
          ? t('{count} duplicate of the same chip', { count: exact(duplicates) })
          : t('{count} duplicates of the same chip', { count: exact(duplicates) }),
      );
    }
  }
  if (state.kind === 'building' && !state.prereqs) {
    notes.push(t('Buildings this needs first are not included; Advanced adds them.'));
  }
  if (state.kind === 'research' && !state.prereqs) {
    notes.push(t('Research and buildings this needs first are not included; Advanced adds them.'));
  }
  if (state.kind === 'vehicle_part') {
    notes.push(t('Every vehicle part costs the same.'));
  }
  if (state.kind === 'exclusive') {
    notes.push(t('Every exclusive weapon takes the same count, in its own fragments.'));
  }
  if (state.kind === 'exclusive' && weaponSegments(state.to).awakening > 0) {
    notes.push(t('Red ranks open season by season.'));
  }
  if (state.kind === 'pet') {
    const breaks = breakthroughsCrossed(state.from, state.to, 0);
    if (breaks.length > 0) {
      notes.push(
        breaks.length === 1
          ? t('Includes {count} breakthrough (level {levels}).', {
              count: breaks.length,
              levels: breaks.join(', '),
            })
          : t('Includes {count} breakthroughs (levels {levels}).', {
              count: breaks.length,
              levels: breaks.join(', '),
            }),
      );
    }
  }
  return notes;
}
