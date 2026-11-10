// What the calculator page works out from its address, with no React and no
// queries: which goals to price, which buffs apply, how a level reads, the
// step table's rows, and the notes under the totals.
//
// Nothing here computes a cost. Goals go to the planner's own plan() and
// every figure comes back out of its totals(), so the reference page cannot
// drift from the planner (the spec's first anti-goal).

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
  };
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

/** One speed figure, whichever clock the kind runs on. */
export function buffsFor(state: Pick<CalculatorState, 'speed' | 'cost'>): Buffs {
  return {
    constructionSpeed: state.speed,
    researchSpeed: state.speed,
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
): string {
  if (kind === 'building') return level === 0 ? 'Not built' : levelText(tiers, subject, level);
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
export function stepTable(steps: ReadonlyArray<PlannedStep>, buffs: Buffs): StepTableModel {
  const sums = totals(steps, buffs);
  return {
    materials: sums.materials,
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
          ? `${short(exp)} star-up EXP`
          : `${short(exp)} EXP = ${exact(Math.ceil(exp / card.amount))} × ${card.name} (${exact(card.amount)} each)`,
      );
    }
    if (duplicates > 0) {
      notes.push(`${exact(duplicates)} duplicate${duplicates === 1 ? '' : 's'} of the same chip`);
    }
  }
  if (state.kind === 'building') {
    notes.push('Buildings this needs first are not included; the planner adds them.');
  }
  if (state.kind === 'research') {
    notes.push('Research and buildings this needs first are not included; the planner adds them.');
  }
  if (state.kind === 'exclusive' && weaponSegments(state.to).awakening > 0) {
    notes.push('Red ranks open season by season.');
  }
  if (state.kind === 'pet') {
    const breaks = breakthroughsCrossed(state.from, state.to, 0);
    if (breaks.length > 0) {
      notes.push(
        `Includes ${breaks.length} breakthrough${breaks.length === 1 ? '' : 's'} (level${breaks.length === 1 ? '' : 's'} ${breaks.join(', ')}).`,
      );
    }
  }
  return notes;
}
