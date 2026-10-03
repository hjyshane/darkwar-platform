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
  name: string;
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
  value_dollars: number;
  value_ratio: number | null;
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
  item_id: string;
  rubies: number;
  source: ValueSource;
  note: string | null;
  updated_at: string;
  name: string | null;
  name_ko: string | null;
}

/** Ruby-shop types: 1 is the full-price shop, 2 and 3 the discount shops. */
export const SHOP_LABELS: Record<number, string> = {
  1: 'Ruby shop',
  2: 'Discount shop',
  3: 'Daily deals',
};

export type PackFilter = 'live' | 'all';

/** On sale at `now`: started, and not ended (a missing end is open). */
export function isLive(pack: Pick<PackValue, 'starts_at' | 'ends_at'>, now: Date): boolean {
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

export async function fetchPacks(): Promise<PackValue[]> {
  const { data, error } = await supabase.from('shop_pack_value').select('*');
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as PackValue[];
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
  const ids = values.map((row) => row.item_id);
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
  return values.map((row) => ({
    ...(row as Omit<ItemValue, 'name' | 'name_ko'>),
    source: row.source as ValueSource,
    name: names.get(row.item_id)?.name ?? null,
    name_ko: names.get(row.item_id)?.name_ko ?? null,
  }));
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
