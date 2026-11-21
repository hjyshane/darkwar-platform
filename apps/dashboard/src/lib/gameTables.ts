// The game client's raw datatables, as `dw-collector game-dump` wrote them
// (0343). Read by admins in Settings > Shared > Game data tables.
//
// Everything a table holds comes down in 1,000-row jsonb pieces plus the
// localisation text its rows use; the browser then sorts, filters and
// resolves on the client. Nothing here knows what a column means — the
// helpers below guess two things only, and say so where they are shown: which
// columns hold a localisation key, and which `*_id` columns name another
// table.

import type { Json } from '@dw/shared-types';
import { supabase } from './supabase';

export type Lang = 'en' | 'ko';
/** `raw` shows the localisation keys themselves. */
export type TextMode = Lang | 'raw';

export interface GameTableMeta {
  name: string;
  client_version: string;
  columns: string[];
  loc_columns: string[];
  row_count: number;
  chunk_count: number;
  byte_size: number;
  dumped_at: string;
}

export interface GameRow {
  id: string;
  values: Record<string, Json | undefined>;
}

export interface GameTable {
  meta: GameTableMeta;
  rows: GameRow[];
  strings: Record<Lang, Record<string, string>>;
}

export interface GameNameHit {
  table_name: string;
  row_id: string;
  name_en: string | null;
  name_ko: string | null;
}

function asStringList(value: Json): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

/** Every table the dump wrote, without its rows. ~470 of them; the 1,000-row
 * cap is far off, and a dump that grew past it would be a different design. */
export async function fetchGameTables(): Promise<GameTableMeta[]> {
  const { data, error } = await supabase
    .from('game_datatables')
    .select(
      'name, client_version, columns, loc_columns, row_count, chunk_count, byte_size, dumped_at',
    )
    .order('name')
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    columns: asStringList(row.columns),
    loc_columns: asStringList(row.loc_columns),
  }));
}

/** One table whole: its pieces in parallel, and its strings in both languages. */
export async function fetchGameTable(meta: GameTableMeta): Promise<GameTable> {
  const [pieces, strings] = await Promise.all([
    supabase
      .from('game_datatable_rows')
      .select('chunk, rows')
      .eq('table_name', meta.name)
      .order('chunk')
      .limit(1000),
    supabase.from('game_datatable_strings').select('lang, strings').eq('table_name', meta.name),
  ]);
  if (pieces.error) throw new Error(pieces.error.message);
  if (strings.error) throw new Error(strings.error.message);
  const rows: GameRow[] = [];
  for (const piece of pieces.data ?? []) {
    const object = piece.rows;
    if (object === null || typeof object !== 'object' || Array.isArray(object)) continue;
    for (const [id, values] of Object.entries(object)) {
      if (values !== null && typeof values === 'object' && !Array.isArray(values)) {
        rows.push({ id, values });
      }
    }
  }
  const text: Record<Lang, Record<string, string>> = { en: {}, ko: {} };
  for (const entry of strings.data ?? []) {
    if (
      (entry.lang === 'en' || entry.lang === 'ko') &&
      entry.strings &&
      typeof entry.strings === 'object'
    ) {
      for (const [key, value] of Object.entries(entry.strings)) {
        if (typeof value === 'string') text[entry.lang][key] = value;
      }
    }
  }
  return { meta, rows, strings: text };
}

/** Which table a name lives in. Both languages, substring, first 50. */
export async function searchGameNames(query: string): Promise<GameNameHit[]> {
  // PostgREST's `or` filter splits on commas and brackets, so those cannot
  // travel inside the pattern; a search for them is not one anybody makes.
  const needle = query
    .trim()
    .replace(/[,()%]/g, ' ')
    .trim();
  if (needle === '') return [];
  const { data, error } = await supabase
    .from('game_datatable_names')
    .select('table_name, row_id, name_en, name_ko')
    .or(`name_en.ilike.%${needle}%,name_ko.ilike.%${needle}%`)
    .order('table_name')
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ------------------------------------------------------------------ guesses

/** Column names whose `*_id` does not spell the table: the client calls an
 * item a "good" (table `goods`), an event an "activity" (table
 * `activity_panel`). Tried only when the plain name finds no table. */
const REF_ALIASES: Record<string, string> = {
  good: 'goods',
  goods: 'goods',
  item: 'goods',
  activity: 'activity_panel',
  science: 'aps_science',
  build: 'building',
  monster: 'aps_monster',
};

/** The table a column's values point at, by its name, or null.
 *
 * `skill_id` → `skill`, `giftid` → `gift`, `good_id` → `goods`. A guess from
 * the name alone, checked only against the list of tables that exist; the
 * link it produces lands on "no row N" when the guess was wrong, which is
 * visible, rather than on the wrong row, which is not. */
export function refTarget(column: string, tables: ReadonlySet<string>): string | null {
  const lower = column.toLowerCase();
  if (lower === 'id') return null;
  const match = /^(.*?)_?id$/.exec(lower);
  if (match === null || match[1] === undefined || match[1] === '') return null;
  const stem = match[1];
  for (const candidate of [stem, `${stem}s`, REF_ALIASES[stem]]) {
    if (candidate !== undefined && tables.has(candidate)) return candidate;
  }
  return null;
}

/** A cell as one line of text: localised columns through the strings of the
 * language on screen (the key itself in `raw` mode, or when the dictionary
 * has no entry), nested tables as compact JSON. */
export function cellText(
  value: Json | undefined,
  localised: boolean,
  mode: TextMode,
  strings: Record<string, string>,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  if (localised && mode !== 'raw') return strings[text] ?? text;
  return text;
}

/** Columns with nothing in any row: null or empty string everywhere. A zero
 * is kept — in these tables 0 is often a real setting, not an absence. */
export function emptyColumns(columns: readonly string[], rows: readonly GameRow[]): Set<string> {
  const empty = new Set<string>();
  for (const column of columns) {
    if (rows.every((row) => row.values[column] === null || row.values[column] === '')) {
      empty.add(column);
    }
  }
  return empty;
}

// ------------------------------------------------------------------ address

export const GAME_DATA_SECTION = 'game-data';
const GAME_DATA_HASH = '#/admin/catalogue/game-data';

export interface ViewerState {
  table: string | null;
  row: string | null;
  mode: TextMode;
}

/** `#/admin/catalogue/game-data?t=goods&r=230101&l=ko` → what to show.
 * Everything after `?` is this screen's own; the route reads only the part
 * before it. */
export function viewerStateFromHash(hash: string): ViewerState {
  const at = hash.indexOf('?');
  const params = new URLSearchParams(at === -1 ? '' : hash.slice(at + 1));
  const lang = params.get('l');
  return {
    table: params.get('t') || null,
    row: params.get('r') || null,
    mode: lang === 'ko' || lang === 'raw' ? lang : 'en',
  };
}

export function viewerHash(state: ViewerState): string {
  const params = new URLSearchParams();
  if (state.table !== null) params.set('t', state.table);
  if (state.row !== null) params.set('r', state.row);
  if (state.mode !== 'en') params.set('l', state.mode);
  const query = params.toString();
  return query === '' ? GAME_DATA_HASH : `${GAME_DATA_HASH}?${query}`;
}

/** Kilobytes or megabytes, one decimal, for the table strip. */
export function sizeLabel(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1000)} kB`;
}
