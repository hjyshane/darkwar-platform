// Items with no name anywhere — not in the game's data, not corrected by an
// officer — and every place they turn up, so a reader can work out what they
// are: the packs that hold them and how many, the Ruby-shop entries that sell
// them, and what the game data says about them (type, quality, icon name).

import { supabase } from '../../lib/supabase';
import { type ItemValue, type ListingValue, type PackValue, SHOP_LABELS } from './data';

export interface Sighting {
  where: 'pack' | 'shop';
  /** Pack name, or the shop's label. */
  label: string;
  qty: number;
  /** Pack price in dollars, or the entry's price in rubies. */
  price: number;
  server_id: number;
}

export interface UnnamedItem {
  item_id: string;
  sightings: Sighting[];
  /** Its value, when it has one: rubies per unit and where that came from. */
  rubies: number | null;
  source: ItemValue['source'] | null;
}

/** Every unnamed item across the three lists, the most-seen first. The same
 * pack on several servers is one sighting: what matters for guessing is what
 * it comes with, not how many servers sell it. */
export function unnamedItems(
  packs: ReadonlyArray<PackValue>,
  listings: ReadonlyArray<ListingValue>,
  values: ReadonlyArray<ItemValue>,
): UnnamedItem[] {
  const found = new Map<string, UnnamedItem>();
  const entry = (id: string) => {
    const held = found.get(id) ?? { item_id: id, sightings: [], rubies: null, source: null };
    found.set(id, held);
    return held;
  };
  const add = (id: string, sighting: Sighting) => {
    const held = entry(id);
    const same = held.sightings.some(
      (s) =>
        s.where === sighting.where &&
        s.label === sighting.label &&
        s.qty === sighting.qty &&
        s.price === sighting.price,
    );
    if (!same) held.sightings.push(sighting);
  };

  for (const pack of packs) {
    for (const item of pack.contents) {
      if (item.name === null) {
        add(item.id, {
          where: 'pack',
          label: pack.name,
          qty: item.qty,
          price: pack.dollars,
          server_id: pack.server_id,
        });
      }
    }
  }
  for (const row of listings) {
    if (row.item_id !== null && row.name === null) {
      add(row.item_id, {
        where: 'shop',
        label: SHOP_LABELS[row.shop_type] ?? `Shop ${row.shop_type}`,
        qty: row.qty,
        price: row.price,
        server_id: row.server_id,
      });
    }
  }
  for (const value of values) {
    if (value.name === null) {
      const held = entry(value.item_id);
      held.rubies = value.rubies;
      held.source = value.source;
    }
  }
  return [...found.values()].sort(
    (a, b) => b.sightings.length - a.sightings.length || a.item_id.localeCompare(b.item_id),
  );
}

export interface ItemHint {
  item_type: number | null;
  quality: number | null;
  icon: string | null;
}

/** What the game's item table knows about them, even without a name. */
export async function fetchHints(ids: string[]): Promise<Map<string, ItemHint>> {
  const out = new Map<string, ItemHint>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('game_items')
      .select('item_id, item_type, quality, icon')
      .in('item_id', ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      out.set(row.item_id, { item_type: row.item_type, quality: row.quality, icon: row.icon });
    }
  }
  return out;
}
