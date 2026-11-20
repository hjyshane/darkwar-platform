// What the calculator reads: the subjects of a kind, the steps of a range,
// and what a chip EXP card is worth. Everything goes through the planner's
// own readers (fetchCatalogSubjects, loadBook, plan), so the two pages price
// from one place; this file only decides how a subject is NAMED for someone
// who has no account open.

import { supabase } from '../../lib/supabase';
import { type Subject, fetchCatalogSubjects, loadBook } from '../planner/data';
import { type Goal, type Plan, type PlannedStep, plan } from '../planner/plan';
import { buildingsForCalculator } from './buildingList';
import { CHIP_EXP, chipSubjectName } from './chips';
import type { ExpCard } from './model';
import type { CalculatorKind } from './url';

/** Hero gear qualities by the colour the game draws them in (owner,
 * 2026-11-19): the client's D1 … D5 pieces. */
export const GEAR_QUALITIES: Readonly<Record<string, string>> = {
  '1': 'Grey',
  '2': 'Green',
  '3': 'Blue',
  '4': 'Purple',
  '5': 'Orange',
};

/** Pet rarities by the grade the game shows (owner, 2026-11-19): rarity 1
 * tops out at level 60 and is C, rarity 4 at 100 and is S. */
export const PET_GRADES: Readonly<Record<string, string>> = {
  '1': 'C',
  '2': 'B',
  '3': 'A',
  '4': 'S',
};

/** "level:q5" with a top level of 100 → "Orange gear · to level 100"; the
 * number itself for a quality with no colour here. */
export function gearSubjectName(subject: string, maxLevel: number): string {
  const quality = subject.replace('level:q', '');
  const colour = GEAR_QUALITIES[quality];
  return `${colour ?? `Quality ${quality}`} gear · to level ${maxLevel}`;
}

/** "4" with a top level of 100 → "S-grade pet · to level 100". */
export function petSubjectName(subject: string, maxLevel: number): string {
  const grade = PET_GRADES[subject];
  return `${grade ? `${grade}-grade pet` : `Pet · rarity ${subject}`} · to level ${maxLevel}`;
}

const byName = (a: Subject, b: Subject) => {
  // A subject the client has no name for reads "#<id>"; those go last.
  const unnamed = Number(a.name.startsWith('#')) - Number(b.name.startsWith('#'));
  return unnamed !== 0 ? unnamed : a.name.localeCompare(b.name);
};
const byId = (a: Subject, b: Subject) => Number(a.subject) - Number(b.subject);

/** The subjects of a kind whose members all cost the same, as ONE entry: the
 * lowest id stands for the rest. Read off the client's tables 2026-11-19: the
 * six vehicle parts (Gun … Wheel) have identical steps, and the eighteen
 * exclusive weapons the same counts, each in its own fragments. Null when the
 * tracks do not end at one level — then they are not one thing after all, and
 * the caller lists them apart. */
function sharedSubject(rows: ReadonlyArray<Subject>, name: string): Subject[] | null {
  const [first, ...rest] = [...rows].sort(byId);
  if (first === undefined) return [];
  if (rest.some((s) => s.maxLevel !== first.maxLevel)) return null;
  return [{ ...first, name, nameKo: null }];
}

/** The catalogue's subjects of a kind, named and ordered for the picker.
 * `heroNames` (hero id → name) is only read for exclusive weapons. */
export function labelSubjects(
  kind: CalculatorKind,
  rows: ReadonlyArray<Subject>,
  heroNames: ReadonlyMap<string, string>,
): Subject[] {
  switch (kind) {
    case 'hero':
      return rows.map((s) => ({ ...s, name: 'Hero level' }));
    case 'vehicle':
      return rows.map((s) => ({ ...s, name: 'Vehicle' }));
    case 'hero_gear':
      // The level track by quality; the stage-up track ("promote") stays with
      // the planner's hero cards.
      return rows
        .filter((s) => s.subject.startsWith('level:q'))
        .map((s) => ({ ...s, name: gearSubjectName(s.subject, s.maxLevel) }))
        .sort((a, b) => a.subject.localeCompare(b.subject));
    case 'chip':
      // The view's name for a chip is its top step's label ("10★ 0/10").
      return rows.map((s) => ({ ...s, name: chipSubjectName(s.subject) })).sort(byId);
    case 'pet':
      return rows.map((s) => ({ ...s, name: petSubjectName(s.subject, s.maxLevel) })).sort(byId);
    case 'vehicle_part':
      return sharedSubject(rows, 'Vehicle part (any)') ?? [...rows].sort(byId);
    case 'exclusive':
      return (
        sharedSubject(rows, 'Exclusive weapon (any)') ??
        rows
          .map((s) => {
            const hero = heroNames.get(s.subject);
            return hero ? { ...s, name: `${s.name} (${hero})` } : s;
          })
          .sort(byName)
      );
    case 'building':
      return buildingsForCalculator(rows).sort(byName);
    default:
      return [...rows].sort(byName);
  }
}

async function fetchHeroNames(heroIds: string[]): Promise<Map<string, string>> {
  const ids = heroIds.map(Number).filter((id) => Number.isInteger(id));
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from('heroes').select('hero_id, name').in('hero_id', ids);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).flatMap((h) => (h.name ? [[String(h.hero_id), h.name] as const] : [])),
  );
}

/** Every subject of a kind. One row per subject (the 0222 summary), so even
 * research — 633 subjects — is under PostgREST's 1,000-row cap. Buildings
 * come with their `gameSeason`; the page splits ordinary from seasonal. */
export async function fetchCalculatorSubjects(kind: CalculatorKind): Promise<Subject[]> {
  const rows = (await fetchCatalogSubjects(kind, {})).filter((s) => s.maxLevel >= 1);
  const labelled = labelSubjects(kind, rows, new Map());
  // Weapons listed apart want their heroes beside them; one entry does not.
  if (kind !== 'exclusive' || labelled.length <= 1) return labelled;
  return labelSubjects(kind, rows, await fetchHeroNames(rows.map((s) => s.subject)));
}

export interface LoadedSteps {
  steps: PlannedStep[];
  /** Levels in the range the catalogue has no step for. */
  gaps: Plan['gaps'];
}

/** The steps of the goals, priced by nobody yet. No prerequisites: the
 * reference has no account, so it cannot say which are already met. */
export async function loadSteps(goals: ReadonlyArray<Goal>): Promise<LoadedSteps> {
  if (goals.length === 0) return { steps: [], gaps: [] };
  const none = new Map<string, number>();
  const book = await loadBook(goals, none, false);
  const { steps, gaps } = plan(goals, book, none, false);
  // A pet's breakthroughs are goals of their own; put each beside the level
  // it sits at, so the table reads in the order the game asks for them.
  return { steps: [...steps].sort((a, b) => a.step.level - b.step.level), gaps };
}

/** The rows of game_items that are chip EXP cards, as what each is worth. */
export function expCardsFrom(
  rows: ReadonlyArray<{ item_id: string; name: string | null; counter_value: unknown }>,
): ExpCard[] {
  return rows.flatMap((row) => {
    const value = row.counter_value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const { id, amount } = value as { id?: unknown; amount?: unknown };
    if (id !== CHIP_EXP || typeof amount !== 'number' || amount <= 0) return [];
    return [{ itemId: row.item_id, name: row.name ?? `EXP card ${row.item_id}`, amount }];
  });
}

/** What each Chip Star-Up EXP Card gives (game_items.counter_value, 0311).
 * Empty until `game-catalog` has been run since that migration. */
export async function fetchExpCards(): Promise<ExpCard[]> {
  const { data, error } = await supabase
    .from('game_items')
    .select('item_id, name, counter_value')
    .not('counter_value', 'is', null);
  if (error) throw new Error(error.message);
  return expCardsFrom(data ?? []);
}
