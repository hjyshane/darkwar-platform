// Reading what the planner needs: the accounts the reader may plan for, the
// cost steps, and names for everything it lists.
//
// Accounts themselves are accounts.ts.
//
// STEPS are loaded per (kind, subject) and only for the levels a goal
// spans — never a whole kind, which for buildings is ten thousand rows past
// PostgREST's 1,000-row cap.

import { supabase } from '../../lib/supabase';
import type { Account } from './accounts';
import { type Tiers, tiersFrom } from './levels';
import { type Goal, type Kind, type Step, type StepBook, bookKey, plan } from './plan';

/** Steps of one subject between two levels (exclusive, inclusive). */
async function fetchSteps(kind: Kind, subject: string, from: number, to: number): Promise<Step[]> {
  const { data, error } = await supabase
    .from('game_upgrade_steps')
    .select('kind, subject_id, level, name, costs, seconds, requires, tier')
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

export interface Subject {
  subject: string;
  name: string;
  maxLevel: number;
  category: number | null;
}

/** Upgradeable things of one kind, from the per-subject summary (0222):
 * every research of a tab, or the named subjects. Never a whole kind of
 * buildings or research at once — research alone is hundreds of subjects. */
export async function fetchCatalogSubjects(
  kind: Kind,
  filter: { category?: number; subjects?: string[] },
): Promise<Subject[]> {
  let query = supabase
    .from('game_upgrade_subjects')
    .select('subject_id, name, max_level, category')
    .eq('kind', kind);
  if (filter.category !== undefined) query = query.eq('category', filter.category);
  if (filter.subjects !== undefined)
    query = query.in('subject_id', filter.subjects.length > 0 ? filter.subjects : ['-']);
  const { data, error } = await query.limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => row.subject_id !== null)
    .map((row) => ({
      subject: row.subject_id as string,
      name: row.name ?? `#${row.subject_id}`,
      maxLevel: row.max_level ?? 0,
      category: row.category,
    }));
}

/** Levels the game shows as an industry tier (Watchtower 35+). */
export async function fetchTiers(): Promise<Tiers> {
  const { data, error } = await supabase
    .from('game_upgrade_steps')
    .select('subject_id, level, tier')
    .eq('kind', 'building')
    .not('tier', 'is', null)
    .limit(1000);
  if (error) throw new Error(error.message);
  return tiersFrom(
    (data ?? []).map((r) => ({ subject_id: r.subject_id, level: r.level, tier: r.tier as number })),
  );
}

export interface ResearchTab {
  tabId: number;
  name: string;
}

/** The research screen's tabs this server sees, in the game's order. */
export async function fetchResearchTabs(serverId: number | null): Promise<ResearchTab[]> {
  const { data, error } = await supabase
    .from('game_research_tabs')
    .select('tab_id, name, sort_order, servers');
  if (error) throw new Error(error.message);
  const sees = (servers: unknown) => {
    const ranges = Array.isArray(servers) ? (servers as [number, number][]) : [];
    return (
      ranges.length === 0 ||
      (serverId !== null && ranges.some(([lo, hi]) => serverId >= lo && serverId <= hi))
    );
  };
  return (data ?? [])
    .filter((t) => sees(t.servers))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.tab_id - b.tab_id)
    .map((t) => ({ tabId: t.tab_id, name: t.name ?? `Tab ${t.tab_id}` }));
}

export interface HeroInfo {
  names: Map<string, string>;
  gear: Map<number, { name: string; quality: number; slot: number | null }>;
  /** Hero ids that have an exclusive weapon, with its highest level. */
  exclusives: Map<string, number>;
  /** The game's rarity by hero id (0229): 1 is the top, yellow tier. */
  rarity: Map<string, number>;
}

/** Names for the hero cards: heroes, the gear they wear, and which heroes
 * have an exclusive weapon at all. */
export async function fetchHeroInfo(account: Account, everything: boolean): Promise<HeroInfo> {
  const heroIds = Object.keys(account.heroLevels).map(Number);
  const gearIds = account.heroGear.map((g) => g.equipId);
  // By hand, every named hero and every gear piece is offered (47 and 60);
  // from a login, only what the account has.
  const heroQuery = supabase.from('heroes').select('hero_id, name');
  const gearQuery = supabase.from('game_hero_gear').select('equip_id, name, quality, slot');
  const [heroes, gear, exclusives, rarity] = await Promise.all([
    everything
      ? heroQuery.not('name', 'is', null)
      : heroQuery.in('hero_id', heroIds.length > 0 ? heroIds : [-1]),
    everything
      ? gearQuery.not('name', 'is', null)
      : gearQuery.in('equip_id', gearIds.length > 0 ? gearIds : [-1]),
    fetchCatalogSubjects('exclusive', {}),
    supabase.from('game_hero_rarity').select('hero_id, rarity'),
  ]);
  if (rarity.error) throw new Error(rarity.error.message);
  if (heroes.error) throw new Error(heroes.error.message);
  if (gear.error) throw new Error(gear.error.message);
  return {
    names: new Map(
      (heroes.data ?? []).map((h) => [String(h.hero_id), h.name ?? `Hero ${h.hero_id}`]),
    ),
    gear: new Map(
      (gear.data ?? []).map((g) => [
        g.equip_id,
        { name: g.name ?? `Gear ${g.equip_id}`, quality: g.quality ?? 0, slot: g.slot },
      ]),
    ),
    exclusives: new Map(exclusives.map((e) => [e.subject, e.maxLevel])),
    rarity: new Map((rarity.data ?? []).map((r) => [String(r.hero_id), r.rarity])),
  };
}
