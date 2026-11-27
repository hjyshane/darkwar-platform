// What an officer says a pack also pays (game_pack_extras, 0355): a pass's
// daily claim, a milestone reward, a first-buy bonus — contents no answer of
// the game carries. One row per item (or per rubies) of a pack, matched like
// the picks (0278): by pack id, or by name key for every pack of that name.
// The view sums them; this file reads and writes the rows.

import { supabase } from '../../lib/supabase';
import type { PackValue } from './data';

export type ExtraMatch = 'pack_id' | 'name_key';

export interface PackExtra {
  extra_id: number;
  match_kind: ExtraMatch;
  match_value: string;
  /** An item code, or null when the extra is rubies. */
  item_id: string | null;
  /** Items per time, or rubies per time. */
  qty: number;
  /** How many times it is paid (a daily claim over 30 days: 30). */
  repeat: number;
  note: string | null;
}

export type ExtraDraft = Omit<PackExtra, 'extra_id'> & { extra_id?: number };

export async function fetchExtras(): Promise<PackExtra[]> {
  const { data, error } = await supabase
    .from('game_pack_extras')
    .select('extra_id, match_kind, match_value, item_id, qty, repeat, note')
    .order('extra_id')
    .limit(1000);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as PackExtra[];
}

/** The extras that reach a pack: its id's, and its name key's. */
export function extrasOf(
  extras: ReadonlyArray<PackExtra>,
  pack: Pick<PackValue, 'pack_id' | 'name_key'>,
): PackExtra[] {
  return extras.filter(
    (x) =>
      (x.match_kind === 'pack_id' && x.match_value === pack.pack_id) ||
      (x.match_kind === 'name_key' && pack.name_key !== null && x.match_value === pack.name_key),
  );
}

/** What a draft is worth per purchase, in rubies, when its item has a value
 * (or it is rubies). Null when the item is unvalued. */
export function extraRubies(
  extra: Pick<PackExtra, 'item_id' | 'qty' | 'repeat'>,
  unit: number | null,
): number | null {
  if (extra.item_id === null) {
    return extra.qty * extra.repeat;
  }
  return unit === null ? null : unit * extra.qty * extra.repeat;
}

function failure(error: { code?: string; message: string }): Error {
  if (error.code === '42501') {
    return new Error('Only officers and admins can enter extras.');
  }
  if (error.code === '23505') {
    return new Error('This pack already has a line for that item; change that one.');
  }
  return new Error(error.message);
}

/** Add an extra, or change one (by extra_id). */
export async function saveExtra(draft: ExtraDraft): Promise<void> {
  const row = {
    match_kind: draft.match_kind,
    match_value: draft.match_value,
    item_id: draft.item_id,
    qty: draft.qty,
    repeat: draft.repeat,
    note: draft.note?.trim() ? draft.note.trim() : null,
  };
  const { error } =
    draft.extra_id === undefined
      ? await supabase.from('game_pack_extras').insert(row)
      : await supabase.from('game_pack_extras').update(row).eq('extra_id', draft.extra_id);
  if (error) {
    throw failure(error);
  }
}

export async function deleteExtra(extraId: number): Promise<void> {
  const { error } = await supabase.from('game_pack_extras').delete().eq('extra_id', extraId);
  if (error) {
    throw failure(error);
  }
}
