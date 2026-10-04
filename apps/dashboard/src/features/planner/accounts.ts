// The accounts the reader may plan for, from two sources:
//
// LOGIN — account_state_latest rows the reader can see: their own
// characters, or every one for an admin (0205). Levels, inventory, resources,
// buffs and exclusive weapons from the newest login (0219, 0221, 0222).
//
// BY HAND — account_state_manual rows (0223), for characters the collector
// never sees log in: the owner or anyone with data.enter types them in. A
// login wins: a character with a login row is never read from here.

import { supabase } from '../../lib/supabase';

export interface Account {
  playerId: string;
  name: string;
  serverId: number | null;
  /** 'login' is the game's own; 'manual' was typed in and can be edited. */
  source: 'login' | 'manual';
  /** When the login was seen, or when the hand entry was last saved. */
  capturedAt: string;
  buildings: Record<string, number>;
  science: Record<string, number>;
  heroLevels: Record<string, number>;
  heroGear: { equipId: number; heroId: number | null; level: number; promote: number }[];
  /** Exclusive weapon level by hero id (0222). */
  heroExclusives: Record<string, number>;
  items: Record<string, number>;
  /** Resource stock by game resource id (0221); empty before parser 1.2.0. */
  resources: Record<string, number>;
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

async function playerNames(
  ids: string[],
): Promise<Map<string, { name: string; serverId: number | null }>> {
  const out = new Map<string, { name: string; serverId: number | null }>();
  // 150 uuids a request keeps the URL well under any proxy's limit.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('players')
      .select('player_id, current_name, server_id')
      .in('player_id', ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const p of data ?? []) {
      out.set(p.player_id, {
        name: p.current_name ?? p.player_id.slice(0, 8),
        serverId: p.server_id,
      });
    }
  }
  return out;
}

export async function fetchAccounts(): Promise<Account[]> {
  const [login, manual] = await Promise.all([
    supabase
      .from('account_state_latest')
      .select(
        'player_id, server_id, captured_at, buildings, science, hero_intensify, hero_equips, hero_exclusives, items, resources, effects, timed_effects',
      ),
    supabase.from('account_state_manual').select('*'),
  ]);
  if (login.error) throw new Error(login.error.message);
  if (manual.error) throw new Error(manual.error.message);

  const loginRows = (login.data ?? []).filter((row) => row.player_id !== null);
  const seen = new Set(loginRows.map((row) => row.player_id as string));
  const manualRows = (manual.data ?? []).filter((row) => !seen.has(row.player_id));
  const players = await playerNames([...seen, ...manualRows.map((row) => row.player_id)]);
  const named = (id: string) => players.get(id)?.name ?? id.slice(0, 8);

  const fromLogin: Account[] = loginRows.map((row) => ({
    playerId: row.player_id as string,
    name: named(row.player_id as string),
    serverId: row.server_id,
    source: 'login',
    capturedAt: row.captured_at ?? '',
    buildings: asRecord(row.buildings),
    science: asRecord(row.science),
    heroLevels: asRecord(row.hero_intensify),
    heroGear: asList(row.hero_equips),
    heroExclusives: asRecord(row.hero_exclusives),
    items: asRecord(row.items),
    resources: asRecord(row.resources),
    effects: asRecord(row.effects),
    timedEffects: asList(row.timed_effects),
  }));
  const fromHand: Account[] = manualRows.map((row) => ({
    ...blankAccount(row.player_id, named(row.player_id), players.get(row.player_id)?.serverId),
    capturedAt: row.updated_at,
    buildings: asRecord(row.buildings),
    science: asRecord(row.science),
    heroLevels: asRecord(row.hero_intensify),
    heroGear: asList(row.hero_equips),
    heroExclusives: asRecord(row.hero_exclusives),
    items: asRecord(row.items),
    resources: asRecord(row.resources),
    effects: asRecord(row.effects),
  }));
  return [...fromLogin, ...fromHand];
}

/** A character with nothing entered yet. */
export function blankAccount(
  playerId: string,
  name: string,
  serverId: number | null | undefined,
): Account {
  return {
    playerId,
    name,
    serverId: serverId ?? null,
    source: 'manual',
    capturedAt: '',
    buildings: {},
    science: {},
    heroLevels: {},
    heroGear: [],
    heroExclusives: {},
    items: {},
    resources: {},
    effects: {},
    timedEffects: [],
  };
}

/** Save a hand-entered account (0223): the whole row, replaced. */
export async function saveManual(account: Account): Promise<void> {
  const { error } = await supabase.from('account_state_manual').upsert({
    player_id: account.playerId,
    buildings: account.buildings,
    science: account.science,
    hero_intensify: account.heroLevels,
    hero_equips: account.heroGear,
    hero_exclusives: account.heroExclusives,
    items: account.items,
    resources: account.resources,
    effects: account.effects,
  });
  if (error) throw new Error(error.message);
}

export interface Enterable {
  playerId: string;
  name: string;
  serverId: number | null;
}

/** Characters the reader may start entering by hand: their own claims, and
 * with data.enter every current alliance member (alliance_roster_latest via
 * member_roster — never players.current_alliance_id). Characters that
 * already have a login or a hand entry are left to the caller to drop. */
export async function fetchEnterable(): Promise<Enterable[]> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  const [claims, canEnter] = await Promise.all([
    uid
      ? supabase.from('user_players').select('player_id').eq('user_id', uid)
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc('has_permission', { p_capability: 'data.enter' }),
  ]);
  if (claims.error) throw new Error(claims.error.message);
  const ids = new Set((claims.data ?? []).map((c) => c.player_id));
  if (canEnter.data === true) {
    const { data, error } = await supabase.from('member_roster').select('player_id').limit(500);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.player_id) ids.add(m.player_id);
  }
  const players = await playerNames([...ids]);
  return [...ids]
    .map((id) => ({
      playerId: id,
      name: players.get(id)?.name ?? id.slice(0, 8),
      serverId: players.get(id)?.serverId ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
