// What packs and Ruby-shop entries are worth (0215).
//
// Values are rubies per unit (game_item_values): an officer's typed value,
// the game's own Ruby-shop price, or an estimate back-solved from the packs'
// value claims — in that order. VIP Points count as 0. A ruby is $0.0099:
// every ruby-only pack is 100 rubies for $0.99.

import { supabase } from '../../lib/supabase';

export const DOLLARS_PER_RUBY = 0.0099;

export type ValueSource = 'officer' | 'game' | 'estimated';

export interface PackItem {
  id: string;
  qty: number;
  name: string | null;
  name_ko: string | null;
  rubies: number | null;
  source: ValueSource | null;
}

export interface PackValue {
  server_id: number;
  pack_id: string;
  /** The game's string key for the name; null when the client has none. */
  name_key: string | null;
  /** What the page shows: an officer's correction, else the game's name. */
  name: string;
  /** The game's own name ("Pack #<id>" when it has none), for grouping. */
  game_name: string;
  renamed: boolean;
  name_ko: string | null;
  dollars: number;
  rubies: number;
  claimed_percent: number | null;
  starts_at: string | null;
  ends_at: string | null;
  captured_at: string;
  item_rubies: number;
  unvalued_items: number;
  contents: PackItem[];
  /** Null for a pack whose contents the pack list does not carry — battle
   * passes, growth passes, login gifts (0216). */
  value_dollars: number | null;
  value_ratio: number | null;
  contents_listed: boolean;
  /** In the server's newest shop catalog (0235); null before any catalog
   * was recorded for the server, when the time window alone decides. */
  listed: boolean | null;
}

export interface ListingValue {
  server_id: number;
  shop_type: number;
  listing_id: string;
  item_id: string | null;
  name: string | null;
  name_ko: string | null;
  qty: number;
  price: number;
  discount: number | null;
  captured_at: string;
  unit_rubies: number | null;
  value_source: ValueSource | null;
  value_ratio: number | null;
}

export interface ItemValue {
  /** The game's item code: the key, never edited. */
  item_id: string;
  rubies: number;
  source: ValueSource;
  note: string | null;
  updated_at: string;
  /** What the page shows: an officer's correction, else the game's name. */
  name: string | null;
  /** The game's own name, and whether an officer has replaced it. */
  game_name: string | null;
  renamed: boolean;
  name_ko: string | null;
}

/** How an item reads wherever it is listed: its name, never its code. The
 * code is for the tooltip. */
export function itemLabel(item: { name: string | null }): string {
  return item.name ?? 'Unnamed item';
}

/** Ruby-shop types: 1 is the full-price shop, 2 and 3 the discount shops. */
export const SHOP_LABELS: Record<number, string> = {
  1: 'Ruby shop',
  2: 'Discount shop',
  3: 'Daily deals',
};

export type PackFilter = 'live' | 'all';

/** On sale at `now`: in the server's newest catalog, started, and not
 * ended (a missing end is open). A pack the newest catalog left out is gone
 * whatever its window says. */
export function isLive(
  pack: Pick<PackValue, 'starts_at' | 'ends_at'> & { listed?: boolean | null },
  now: Date,
): boolean {
  if (pack.listed === false) {
    return false;
  }
  const t = now.getTime();
  const started = pack.starts_at === null || Date.parse(pack.starts_at) <= t;
  const open = pack.ends_at === null || Date.parse(pack.ends_at) > t;
  return started && open;
}

/** Best value first; packs with no ratio (free) last. */
export function byValue<T extends { value_ratio: number | null }>(rows: ReadonlyArray<T>): T[] {
  return [...rows].sort((a, b) => (b.value_ratio ?? -1) - (a.value_ratio ?? -1));
}

/** "×3.4" — how many dollars of value a dollar buys. */
export function ratioLabel(ratio: number | null): string {
  return ratio === null ? '—' : `×${ratio.toFixed(1)}`;
}

/** $ worth of `rubies`. */
export function dollarsOf(rubies: number): number {
  return Math.round(rubies * DOLLARS_PER_RUBY * 100) / 100;
}

export function money(value: number): string {
  return `$${value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Share of the pack's value from items whose value is only estimated —
 * how much of the ratio rests on the back-solve. */
export function estimatedShare(pack: Pick<PackValue, 'rubies' | 'contents'>): number {
  let total = pack.rubies;
  let estimated = 0;
  for (const item of pack.contents) {
    const value = (item.rubies ?? 0) * item.qty;
    total += value;
    if (item.source === 'estimated') {
      estimated += value;
    }
  }
  return total > 0 ? estimated / total : 0;
}

/** What a pack-name correction is keyed by (0227): the offer itself — its
 * name key (or id), price, rubies and contents. Every id one offer is listed
 * under, and its reissues, share it; two packs that only share a name (each
 * VIP level's VIP Exclusive) do not. */
export function packKey(
  pack: PackValue | Omit<PackValue, 'game_name' | 'renamed' | 'listed'>,
): string {
  return `${pack.name_key ?? `pack:${pack.pack_id}`}|${pack.dollars}|${pack.rubies}|${contentsKey(pack)}`;
}

/** Each server's newest catalog as a set of pack ids (0235). Content-keyed
 * pack rows keep every pack ever seen; this says which the shop lists now. */
export function catalogSets(
  rows: ReadonlyArray<{ server_id: number | null; pack_ids: unknown }>,
): Map<number, Set<string>> {
  const sets = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.server_id !== null && Array.isArray(row.pack_ids)) {
      sets.set(row.server_id, new Set(row.pack_ids.map(String)));
    }
  }
  return sets;
}

export async function fetchPacks(): Promise<PackValue[]> {
  const [packs, fixes, catalogs] = await Promise.all([
    supabase.from('shop_pack_value').select('*'),
    supabase.from('game_pack_names').select('pack_key, name'),
    supabase.from('shop_pack_catalog_latest').select('server_id, pack_ids'),
  ]);
  if (catalogs.error) {
    throw new Error(catalogs.error.message);
  }
  const listedOn = catalogSets(catalogs.data ?? []);
  if (packs.error) {
    throw new Error(packs.error.message);
  }
  if (fixes.error) {
    throw new Error(fixes.error.message);
  }
  const renamed = new Map((fixes.data ?? []).map((f) => [f.pack_key, f.name]));
  return (
    (packs.data ?? []) as unknown as Omit<PackValue, 'game_name' | 'renamed' | 'listed'>[]
  ).map((pack) => {
    const fixed = renamed.get(packKey(pack));
    const catalog = listedOn.get(pack.server_id);
    return {
      ...pack,
      listed: catalog ? catalog.has(pack.pack_id) : null,
      name: fixed ?? pack.name,
      game_name: pack.name,
      renamed: fixed !== undefined,
    };
  });
}

export async function fetchListings(): Promise<ListingValue[]> {
  const { data, error } = await supabase.from('shop_listing_value').select('*');
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as ListingValue[];
}

/** Every valued item with its name. Names come in a second query, by id, so
 * the 1,869-row item table never has to fit under the 1,000-row cap. */
export async function fetchItemValues(): Promise<ItemValue[]> {
  const { data, error } = await supabase
    .from('game_item_values')
    .select('item_id, rubies, source, note, updated_at')
    .limit(1000);
  if (error) {
    throw new Error(error.message);
  }
  const values = data ?? [];
  const names = new Map<string, { name: string | null; name_ko: string | null }>();
  const renamed = new Map<string, string>();
  const ids = values.map((row) => row.item_id);
  const { data: fixes, error: fixError } = await supabase
    .from('game_item_names')
    .select('item_id, name')
    .limit(1000);
  if (fixError) {
    throw new Error(fixError.message);
  }
  for (const fix of fixes ?? []) {
    renamed.set(fix.item_id, fix.name);
  }
  for (let i = 0; i < ids.length; i += 200) {
    const { data: items, error: nameError } = await supabase
      .from('game_items')
      .select('item_id, name, name_ko')
      .in('item_id', ids.slice(i, i + 200));
    if (nameError) {
      throw new Error(nameError.message);
    }
    for (const item of items ?? []) {
      names.set(item.item_id, { name: item.name, name_ko: item.name_ko });
    }
  }
  return values.map((row) => {
    const gameName = names.get(row.item_id)?.name ?? null;
    const fixed = renamed.get(row.item_id);
    return {
      ...(row as Omit<ItemValue, 'name' | 'game_name' | 'renamed' | 'name_ko'>),
      source: row.source as ValueSource,
      name: fixed ?? gameName,
      game_name: gameName,
      renamed: fixed !== undefined,
      name_ko: names.get(row.item_id)?.name_ko ?? null,
    };
  });
}

/** Set an item's value; the database marks it the officer's (0215). */
export async function saveItemValue(itemId: string, rubies: number, note: string): Promise<void> {
  const { error } = await supabase
    .from('game_item_values')
    .upsert(
      { item_id: itemId, rubies, source: 'officer', note: note.trim() === '' ? null : note.trim() },
      { onConflict: 'item_id' },
    );
  if (error) {
    throw new Error(
      error.code === '42501' ? 'Only officers and admins can set values.' : error.message,
    );
  }
}

/** One offer as the page lists it: packs with the same name, price, rubies
 * and contents under one row. The game lists one offer under many ids —
 * a battle pass per tier (26 ids for Legend Battle Pass), a daily deal per
 * slot (14 for Treasure of the Day) — and they read as duplicates. Packs that
 * differ in a single item stay apart: that is a real choice. */
export interface PackGroup extends PackValue {
  /** Name, price, rubies and contents: stable across reads and new ids, so
   * a hidden offer stays hidden when the game reissues it. */
  key: string;
  offers: number;
  pack_ids: string[];
  /** Share of the value resting on estimates, for sorting. */
  estimated: number;
  /** Every rename key among its packs: one, unless two name keys read the
   * same in English. A rename is saved under all of them. */
  rename_keys: string[];
}

function contentsKey(pack: Pick<PackValue, 'contents'>): string {
  return pack.contents
    .map((item) => `${item.id}:${item.qty}`)
    .sort()
    .join(',');
}

export function groupPacks(packs: ReadonlyArray<PackValue>): PackGroup[] {
  const groups = new Map<string, PackGroup>();
  for (const pack of packs) {
    // The game's name, not a correction: renaming must not split, merge or
    // un-hide an offer.
    const key = `${pack.game_name}|${pack.dollars}|${pack.rubies}|${contentsKey(pack)}`;
    const held = groups.get(key);
    if (held === undefined) {
      groups.set(key, {
        ...pack,
        key,
        offers: 1,
        pack_ids: [pack.pack_id],
        estimated: estimatedShare(pack),
        rename_keys: [packKey(pack)],
      });
    } else {
      held.offers += 1;
      held.pack_ids.push(pack.pack_id);
      const key = packKey(pack);
      if (!held.rename_keys.includes(key)) held.rename_keys.push(key);
    }
  }
  return [...groups.values()];
}

/** Correct an item's name, or clear the correction (empty) to show the
 * game's name again. The item code is the key and is never changed. */
export async function saveItemName(itemId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  const { error } =
    trimmed === ''
      ? await supabase.from('game_item_names').delete().eq('item_id', itemId)
      : await supabase
          .from('game_item_names')
          .upsert({ item_id: itemId, name: trimmed }, { onConflict: 'item_id' });
  if (error) {
    throw new Error(
      error.code === '42501' ? 'Only officers and admins can rename items.' : error.message,
    );
  }
}

/** Correct a pack's name, or clear the correction (empty) to show the
 * game's name again (0225). */
export async function savePackName(keys: string[], name: string): Promise<void> {
  const trimmed = name.trim();
  const { error } =
    trimmed === ''
      ? await supabase.from('game_pack_names').delete().in('pack_key', keys)
      : await supabase.from('game_pack_names').upsert(
          keys.map((key) => ({ pack_key: key, name: trimmed })),
          { onConflict: 'pack_key' },
        );
  if (error) {
    throw new Error(
      error.code === '42501' ? 'Only officers and admins can rename packs.' : error.message,
    );
  }
}

const HIDDEN_KEY = 'shop-value-hidden';

/** Offers this browser has hidden. Per viewer, and only a convenience: a
 * private window or cleared storage simply shows everything again. */
export function loadHidden(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function storeHidden(hidden: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // Storage blocked: hiding still works until the page is reloaded.
  }
}

/** The pack search: the pack's name (English or Korean), any item inside it
 * by name, or a pack id. Case-insensitive; empty matches everything. */
export function matchesPack(pack: PackValue, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return (
    pack.name.toLowerCase().includes(needle) ||
    pack.game_name.toLowerCase().includes(needle) ||
    (pack.name_ko ?? '').includes(needle) ||
    pack.pack_id === needle ||
    pack.contents.some(
      (item) =>
        (item.name ?? '').toLowerCase().includes(needle) || (item.name_ko ?? '').includes(needle),
    )
  );
}
