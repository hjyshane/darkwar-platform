// Names, order and visibility an admin sets from the page (0279).
//
// DISPLAY ONLY. An override changes what is drawn, never an address, a data
// key or a sort key. Nothing stored means the code's default; clearing a row
// puts it back. The helpers here are pure so every screen applies an override
// the same way and the rules are tested once.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

export type OverrideKind = 'label' | 'order' | 'hidden';

/** Every stored override, keyed by scope, key and kind. */
export type Overrides = ReadonlyMap<string, string>;

export const NO_OVERRIDES: Overrides = new Map();

/** The longest name the table accepts. */
export const MAX_LABEL = 60;

const SEP = '\u0000';

export function overrideKey(scope: string, key: string, kind: OverrideKind): string {
  return `${scope}${SEP}${key}${SEP}${kind}`;
}

export function overridesFromRows(
  rows: ReadonlyArray<{ scope: string; key: string; kind: string; value: string }>,
): Overrides {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.kind === 'label' || row.kind === 'order' || row.kind === 'hidden') {
      map.set(overrideKey(row.scope, row.key, row.kind), row.value);
    }
  }
  return map;
}

/** The name to draw: the override, else the default. */
export function labelOf(o: Overrides, scope: string, key: string, fallback: string): string {
  const value = o.get(overrideKey(scope, key, 'label'));
  return value === undefined || value.trim() === '' ? fallback : value;
}

export function isHidden(o: Overrides, scope: string, key: string): boolean {
  return o.get(overrideKey(scope, key, 'hidden')) === 'true';
}

function orderOf(o: Overrides, scope: string, key: string): number | null {
  const value = o.get(overrideKey(scope, key, 'order'));
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** The items in the order the admin set, the rest after them in the order the
 * code gave them. Stable: two items with the same position keep the code's
 * order. A copy; the input is not touched. */
export function arrange<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  o: Overrides,
  scope: string,
): T[] {
  return items
    .map((item, index) => ({ item, index, order: orderOf(o, scope, keyOf(item)) }))
    .sort((a, b) => {
      if (a.order !== null && b.order !== null) {
        return a.order - b.order || a.index - b.index;
      }
      if (a.order !== null) return -1;
      if (b.order !== null) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** Positions to store after moving `key` one place in `keys` (the order as
 * drawn now). Every key gets a position, so the result does not depend on
 * which of them had one before. Null when it cannot move. */
export function moveKey(
  keys: readonly string[],
  key: string,
  direction: -1 | 1,
): Record<string, number> | null {
  const from = keys.indexOf(key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= keys.length) return null;
  const next = [...keys];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as string);
  return Object.fromEntries(next.map((k, index) => [k, index]));
}

/** Why a name is not acceptable, or null. Mirrors the table's checks so the
 * edit box can say so before the database does. */
export function labelProblem(text: string): string | null {
  const t = text.trim();
  if (t === '') return 'A name cannot be empty.';
  if (t.length > MAX_LABEL) return `A name is at most ${MAX_LABEL} characters.`;
  if (/[<>]/.test(t)) return 'A name is plain text: no < or >.';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the check
  if (/[\u0000-\u001f\u007f]/.test(t)) return 'A name cannot hold control characters.';
  return null;
}

// -------------------------------------------------------------------- reads

export async function fetchOverrides(): Promise<Overrides> {
  const { data, error } = await supabase.from('ui_overrides').select('scope, key, kind, value');
  if (error) {
    // A reader who may not read it, or a database without the table yet, gets
    // the defaults rather than a broken sidebar.
    if (error.code === '42501' || error.code === '42P01' || error.code === 'PGRST205') {
      return NO_OVERRIDES;
    }
    throw new Error(`ui overrides query failed: ${error.message}`);
  }
  return overridesFromRows(data ?? []);
}

export function useUiOverrides(): Overrides {
  const { data } = useQuery({
    queryKey: ['ui-overrides'],
    queryFn: fetchOverrides,
    staleTime: 5 * 60_000,
  });
  return data ?? NO_OVERRIDES;
}

// ------------------------------------------------------------------- writes

export interface OverrideChange {
  scope: string;
  key: string;
  kind: OverrideKind;
  /** Null puts the default back. */
  value: string | null;
}

async function apply(change: OverrideChange): Promise<void> {
  const { error } =
    change.value === null
      ? await supabase.rpc('clear_ui_override', {
          p_scope: change.scope,
          p_key: change.key,
          p_kind: change.kind,
        })
      : await supabase.rpc('set_ui_override', {
          p_scope: change.scope,
          p_key: change.key,
          p_kind: change.kind,
          p_value: change.value,
        });
  if (error) {
    throw new Error(error.message);
  }
}

/** Save one or several changes together, then refresh every screen's names. */
export function useSaveOverrides() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (changes: readonly OverrideChange[]) => {
      for (const change of changes) {
        await apply(change);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ui-overrides'] }),
  });
}

/** Put the defaults back for every key in a scope. */
export function useResetScope() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ scope, keys }: { scope: string; keys: readonly string[] }) => {
      for (const key of keys) {
        const { error } = await supabase.rpc('clear_ui_override', { p_scope: scope, p_key: key });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ui-overrides'] }),
  });
}
