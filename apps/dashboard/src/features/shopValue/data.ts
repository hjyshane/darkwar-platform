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
  /** The game's reward type, on picks only: 7 is an item, 40 hero gear. */
  type?: string | null;
}

/** One way to fill a pick: a few rewards taken together. */
export interface PackChoiceOption {
  rubies: number;
  /** Rewards in this option with no value yet. */
  unvalued: number;
  items: PackItem[];
  /** Options of equal value the view folded into this one - a daily
   * package's hero shards differ only in the hero (0278) - and a few of
   * their names. Absent on an option that stands alone. */
  same?: number;
  names?: string[];
  /** Whether the pack's value takes this option; absent where the best
   * option of the pick is the one taken. */
  counted?: boolean;
}

/** One pick the buyer makes: the options to choose between (0276). A pack
 * with two slots is two picks, usually from the same options. */
export type PackChoiceSlot = PackChoiceOption[];

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
  /** The picks a buyer makes on top of `contents`; the value counts the best
   * option of each (0276). Empty for a pack with nothing to choose. */
  choices: PackChoiceSlot[];
  /** Rubies the best option of every slot adds. */
  choice_rubies: number;
  /** Null for a pack whose contents the pack list does not carry — battle
   * passes, growth passes, login gifts (0216). */
  value_dollars: number | null;
  value_ratio: number | null;
  contents_listed: boolean;
  /** In the server's newest shop catalog (0235); null before any catalog
   * was recorded for the server, when the time window alone decides. */
  listed: boolean | null;
  /** The game's pack type, the key to `packCategory`. */
  pack_type?: string | null;
  /** What the game checks before it shows the pack (0284). `show_type` is
   * "6;<item>" for a pack shown only while the player holds that event
   * item; empty for one the store shows on its own. */
  is_show?: string | null;
  show_type?: string | null;
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

/** live: in the store now. event: in the catalog and its window but shown
 * only with an event item held. all: every pack ever seen. */
export type PackFilter = 'live' | 'event' | 'all';

/** The game shows the pack only while the player holds an item (the event
 * currency the pack is for), or on a trigger: not a store listing. */
export function isGated(pack: Pick<PackValue, 'show_type'>): boolean {
  return (pack.show_type ?? '').trim() !== '';
}

/** What the store lists now: on sale (catalog and window) and not gated. */
export function isInStore(
  pack: Pick<PackValue, 'starts_at' | 'ends_at' | 'show_type'> & { listed?: boolean | null },
  now: Date,
): boolean {
  return isLive(pack, now) && !isGated(pack);
}

/** The game marks a name up for display ("<b>100</b>-Ruby Pack"); a page
 * of plain text shows the words. */
export function plainName(name: string): string {
  return name.replace(/<[^>]*>/g, '').trim();
}

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

export interface PackCategory {
  key: string;
  label: string;
  icon: string;
}

export const PACK_CATEGORIES: ReadonlyArray<PackCategory> = [
  { key: 'daily', label: 'Daily deals', icon: '\u2600\uFE0F' },
  { key: 'weekly', label: 'Weekly passes', icon: '\u{1F4C5}' },
  { key: 'goods', label: 'Pick-your-reward packs', icon: '\u{1F381}' },
  { key: 'items', label: 'Item packs', icon: '\u{1F4E6}' },
  { key: 'rubies', label: 'Ruby & currency packs', icon: '\u{1F48E}' },
  { key: 'pass', label: 'Battle & growth passes', icon: '\u{1F3C5}' },
  { key: 'hero', label: 'Heroes & gear', icon: '\u2694\uFE0F' },
  { key: 'other', label: 'Other', icon: '\u{1F3F7}\uFE0F' },
];

/** The game's `type` of a pack, by the category it reads as. Read off the
 * names the types carry on the collector's server (2026-10-11): 26 is every
 * Daily Package, 27 every weekly pass, 24 the goods packs with a pick, 15 the
 * ruby packs and the event-currency packs, 25 the passes. A type not listed
 * is Other: add it here when it turns up. */
const CATEGORY_BY_TYPE: Readonly<Record<string, string>> = {
  '26': 'daily',
  '41': 'daily',
  '27': 'weekly',
  '31': 'weekly',
  '24': 'goods',
  '44': 'goods',
  '16': 'items',
  '1': 'rubies',
  '3': 'rubies',
  '15': 'rubies',
  '25': 'pass',
  '14': 'pass',
  '29': 'pass',
  '50': 'pass',
  '5': 'pass',
  '37': 'pass',
  '38': 'pass',
  '39': 'pass',
  '45': 'pass',
  '46': 'pass',
  '88': 'hero',
  '666': 'hero',
  '28': 'hero',
  '51': 'hero',
};

const OTHER_CATEGORY = PACK_CATEGORIES[PACK_CATEGORIES.length - 1] as PackCategory;

export function packCategory(type: string | null | undefined): PackCategory {
  const key = type === null || type === undefined ? undefined : CATEGORY_BY_TYPE[type];
  return PACK_CATEGORIES.find((c) => c.key === key) ?? OTHER_CATEGORY;
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

/** The option of a slot the value counts: the one worth most (the first on
 * a tie). */
export function bestOption(slot: PackChoiceSlot): PackChoiceOption | undefined {
  let best: PackChoiceOption | undefined;
  for (const option of slot) {
    if (best === undefined || option.rubies > best.rubies) {
      best = option;
    }
  }
  return best;
}

/** Share of the pack's value from items whose value is only estimated —
 * how much of the ratio rests on the back-solve. The best option of each
 * pick counts, as it does in the value. */
export function estimatedShare(
  pack: Pick<PackValue, 'rubies' | 'contents'> & { choices?: ReadonlyArray<PackChoiceSlot> },
): number {
  let total = pack.rubies;
  let estimated = 0;
  const counted = [...pack.contents];
  for (const slot of pack.choices ?? []) {
    counted.push(...(bestOption(slot)?.items ?? []));
  }
  for (const item of counted) {
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
      // A database from before 0276 has neither column.
      choices: Array.isArray(pack.choices) ? pack.choices : [],
      choice_rubies: pack.choice_rubies ?? 0,
      listed: catalog ? catalog.has(pack.pack_id) : null,
      name: plainName(fixed ?? pack.name),
      game_name: plainName(pack.name),
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

/** What a pack lets its buyer pick, as a key: the same offers share it, and
 * two packs that offer different picks (the pick-one gem packs differ only
 * here) do not. Not part of `packKey`: renames were saved before picks were
 * listed and must keep matching. */
function choicesKey(pack: Pick<PackValue, 'choices'>): string {
  return pack.choices
    .map((slot) =>
      slot
        .map((option) =>
          option.items
            .map((item) => `${item.id}:${item.qty}`)
            .sort()
            .join('+'),
        )
        .sort()
        .join('/'),
    )
    .join(';');
}

export function groupPacks(packs: ReadonlyArray<PackValue>): PackGroup[] {
  const groups = new Map<string, PackGroup>();
  for (const pack of packs) {
    // The game's name, not a correction: renaming must not split, merge or
    // un-hide an offer.
    const key = `${pack.game_name}|${pack.dollars}|${pack.rubies}|${contentsKey(pack)}|${choicesKey(pack)}`;
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

/** One offer's place among the packs the game lists under its name and price
 * (0280). The server sends every variant; which one this server sells is an
 * officer's choice, made once per name. */
export interface VariantInfo {
  /** "<game name>|<price>": what the packs of one family share. */
  family_key: string;
  /** A hash of the variant's contents and picks. */
  variant_key: string;
  /** Variants in the family among the packs on the page. */
  variants: number;
  /** This is the variant an officer chose. */
  picked: boolean;
  /** The family has a choice and its variant is on the page. */
  family_picked: boolean;
  /** The family has a choice but its variant is no longer listed: the game
   * moved to another stage, and the choice wants making again. */
  stale: boolean;
}

export type PackRow = PackGroup & VariantInfo;

export function familyKey(pack: Pick<PackValue, 'game_name' | 'dollars'>): string {
  return `${pack.game_name}|${pack.dollars}`;
}

/** Two 32-bit FNV-1a hashes, as 16 hex digits: short enough for a key, stable
 * across reads, and the same offer reissued under new ids hashes the same. */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function variantKey(
  pack: Pick<PackValue, 'rubies' | 'contents' | 'choices' | 'claimed_percent'>,
): string {
  return fingerprint(`${pack.rubies}|${contentsKey(pack)}|${choicesKey(pack)}`);
}

/** Fold same-name, same-price variants to the one an officer chose. A family
 * with one variant is left alone; so is one whose chosen variant is not on the
 * page (it is flagged `stale` instead, and every variant stays). `showAll`
 * keeps every variant, marking the chosen one. */
export function foldVariants(
  groups: ReadonlyArray<PackGroup>,
  choices: ReadonlyMap<string, string>,
  showAll: boolean,
): { rows: PackRow[]; hidden: number } {
  const families = new Map<string, PackGroup[]>();
  for (const group of groups) {
    const key = familyKey(group);
    const held = families.get(key);
    if (held === undefined) {
      families.set(key, [group]);
    } else {
      held.push(group);
    }
  }
  const rows: PackRow[] = [];
  let hidden = 0;
  for (const group of groups) {
    const family_key = familyKey(group);
    const members = families.get(family_key) ?? [group];
    const chosen = choices.get(family_key);
    const keys = members.map((m) => variantKey(m));
    const mine = variantKey(group);
    const present = chosen !== undefined && keys.includes(chosen) && members.length > 1;
    const row: PackRow = {
      ...group,
      family_key,
      variant_key: mine,
      variants: members.length,
      picked: present && mine === chosen,
      family_picked: present,
      stale: chosen !== undefined && !present && members.length > 1,
    };
    if (present && !row.picked && !showAll) {
      hidden += 1;
      continue;
    }
    rows.push(row);
  }
  return { rows, hidden };
}

/** The variant chosen for each family, by family key. */
export async function fetchVariantChoices(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('game_pack_variants')
    .select('family_key, variant_key')
    .limit(1000);
  if (error) {
    throw new Error(error.message);
  }
  return new Map((data ?? []).map((row) => [row.family_key, row.variant_key]));
}

/** Say which variant of a family this server sells, or clear the choice
 * (null) to show them all again. */
export async function saveVariantChoice(family: string, variant: string | null): Promise<void> {
  const { error } =
    variant === null
      ? await supabase.from('game_pack_variants').delete().eq('family_key', family)
      : await supabase
          .from('game_pack_variants')
          .upsert({ family_key: family, variant_key: variant }, { onConflict: 'family_key' });
  if (error) {
    throw new Error(
      error.code === '42501' ? 'Only officers and admins can choose a variant.' : error.message,
    );
  }
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
    [...pack.contents, ...pack.choices.flat().flatMap((option) => option.items)].some(
      (item) =>
        (item.name ?? '').toLowerCase().includes(needle) || (item.name_ko ?? '').includes(needle),
    )
  );
}
