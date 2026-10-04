// Reading what the planner needs: the accounts the reader may plan for, the
// cost steps, and names for everything it lists.
//
// ACCOUNTS are account_state_latest rows the reader can see: their own
// characters, or every one for an admin (0205). Each carries its levels,
// inventory and buffs from its newest login (0219).
//
// STEPS are loaded per (kind, subject) and only for the levels a goal
// spans — never a whole kind, which for buildings is ten thousand rows past
// PostgREST's 1,000-row cap.

import { supabase } from '../../lib/supabase';
import { type Goal, type Kind, type Step, type StepBook, bookKey, plan } from './plan';

export interface Account {
  playerId: string;
  name: string;
  capturedAt: string;
  buildings: Record<string, number>;
  science: Record<string, number>;
  heroLevels: Record<string, number>;
  heroGear: { equipId: number; heroId: number | null; level: number; promote: number }[];
  items: Record<string, number>;
  effects: Record<string, number>;
  timedEffects: {
    state: number | null;
    effect: number;
    value: number;
    start: number | null;
    end: number;
  }[];
}

function asRecord(value: unknown): Record<string, number> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, number>)
    : {};
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from('account_state_latest')
    .select(
      'player_id, captured_at, buildings, science, hero_intensify, hero_equips, items, effects, timed_effects',
    );
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []).filter((row) => row.player_id !== null);
  const ids = rows.map((row) => row.player_id as string);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: players, error: nameError } = await supabase
      .from('players')
      .select('player_id, current_name')
      .in('player_id', ids);
    if (nameError) {
      throw new Error(nameError.message);
    }
    for (const p of players ?? []) {
      names.set(p.player_id, p.current_name ?? p.player_id.slice(0, 8));
    }
  }
  return rows.map((row) => ({
    playerId: row.player_id as string,
    name: names.get(row.player_id as string) ?? (row.player_id as string).slice(0, 8),
    capturedAt: row.captured_at ?? '',
    buildings: asRecord(row.buildings),
    science: asRecord(row.science),
    heroLevels: asRecord(row.hero_intensify),
    heroGear: asList(row.hero_equips),
    items: asRecord(row.items),
    effects: asRecord(row.effects),
    timedEffects: asList(row.timed_effects),
  }));
}

/** Steps of one subject between two levels (exclusive, inclusive). */
async function fetchSteps(kind: Kind, subject: string, from: number, to: number): Promise<Step[]> {
  const { data, error } = await supabase
    .from('game_upgrade_steps')
    .select('kind, subject_id, level, name, costs, seconds, requires')
    .eq('kind', kind)
    .eq('subject_id', subject)
    .gt('level', from)
    .lte('level', to)
    .order('level')
    .limit(1000);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as Step[];
}

/** The book a plan needs: every goal's steps, then every building a
 * requirement names, loaded round by round until nothing is missing. A
 * prerequisite is loaded only up to the level it is needed at. */
export async function loadBook(
  goals: ReadonlyArray<Goal>,
  levels: ReadonlyMap<string, number>,
  withPrerequisites: boolean,
): Promise<StepBook> {
  const book: StepBook = new Map();
  const put = (steps: Step[], kind: Kind, subject: string) => {
    const key = bookKey(kind, subject);
    const held = book.get(key) ?? new Map<number, Step>();
    for (const s of steps) {
      held.set(s.level, s);
    }
    book.set(key, held);
  };
  await Promise.all(
    goals.map(async (goal) =>
      put(await fetchSteps(goal.kind, goal.subject, goal.from, goal.to), goal.kind, goal.subject),
    ),
  );
  // A requirement can name any level of any building; load its whole climb
  // from the account's level to the highest the game has, once.
  for (let round = 0; round < 10; round += 1) {
    const { missing } = plan(goals, book, levels, withPrerequisites);
    if (missing.length === 0) {
      break;
    }
    await Promise.all(
      missing.map(async (subject) =>
        put(
          await fetchSteps('building', subject, levels.get(subject) ?? 0, 200),
          'building',
          subject,
        ),
      ),
    );
  }
  return book;
}

export interface Names {
  items: Map<string, string>;
  resources: Map<string, string>;
}

/** Names for the materials a plan totals. */
export async function fetchMaterialNames(itemIds: string[]): Promise<Names> {
  const items = new Map<string, string>();
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data, error } = await supabase
      .from('game_items')
      .select('item_id, name')
      .in('item_id', itemIds.slice(i, i + 200));
    if (error) {
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      if (row.name) items.set(row.item_id, row.name);
    }
  }
  const resources = new Map<string, string>();
  const { data, error } = await supabase.from('game_resources').select('resource_id, name');
  if (error) {
    throw new Error(error.message);
  }
  for (const row of data ?? []) {
    if (row.name) resources.set(String(row.resource_id), row.name);
  }
  return { items, resources };
}

export interface SubjectOption {
  subject: string;
  name: string;
  current: number;
}

/** What the goal picker lists for one kind, with the account's level. Names
 * come from the subject's first step (buildings, research), the heroes table
 * (heroes) or game_hero_gear (gear). */
export async function fetchSubjects(kind: Kind, account: Account): Promise<SubjectOption[]> {
  if (kind === 'hero_gear') {
    const ids = account.heroGear.map((g) => g.equipId);
    const { data, error } = await supabase
      .from('game_hero_gear')
      .select('equip_id, name, quality')
      .in('equip_id', ids.length > 0 ? ids : [-1]);
    if (error) throw new Error(error.message);
    const byId = new Map((data ?? []).map((g) => [g.equip_id, g]));
    return account.heroGear.map((g, index) => {
      const info = byId.get(g.equipId);
      return {
        // index keeps two copies of one piece apart; quality picks the list.
        subject: `${index}:${g.equipId}:${info?.quality ?? 0}`,
        name: `${info?.name ?? `Gear ${g.equipId}`} (hero ${g.heroId ?? '—'})`,
        current: g.level,
      };
    });
  }
  if (kind === 'hero') {
    const ids = Object.keys(account.heroLevels).map(Number);
    const { data, error } = await supabase
      .from('heroes')
      .select('hero_id, name')
      .in('hero_id', ids.length > 0 ? ids : [-1]);
    if (error) throw new Error(error.message);
    const names = new Map((data ?? []).map((h) => [String(h.hero_id), h.name]));
    return Object.entries(account.heroLevels)
      .map(([id, level]) => ({ subject: id, name: names.get(id) ?? `Hero ${id}`, current: level }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const levels = kind === 'building' ? account.buildings : account.science;
  const subjects = Object.keys(levels);
  const names = new Map<string, string>();
  for (let i = 0; i < subjects.length; i += 150) {
    const { data, error } = await supabase
      .from('game_upgrade_steps')
      .select('subject_id, name')
      .eq('kind', kind)
      .in('subject_id', subjects.slice(i, i + 150))
      .eq('level', kind === 'building' ? 2 : 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.name) names.set(row.subject_id, row.name);
    }
  }
  return subjects
    .map((s) => ({ subject: s, name: names.get(s) ?? `#${s}`, current: levels[s] ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
