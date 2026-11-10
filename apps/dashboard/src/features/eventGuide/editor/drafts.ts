// What the section editor does to a payload before the database sees it
// (0310). Pure: the forms hold a payload, change it through these helpers, and
// ask `validateDraft` whether Save may be offered and, if not, why.

import { type SectionKind, type SectionPayload, parseSection } from '../sections/index';

/** Where a new section of each kind starts. Every structured kind starts
 * from something that already saves (an empty list is a valid list); notes
 * start empty and need text. */
export function emptyPayload(kind: SectionKind): SectionPayload['payload'] {
  switch (kind) {
    case 'rewards':
      return { items: [] };
    case 'stages':
      return { groups: [], totals: [] };
    case 'point_table':
      return { day: null, theme: null, rows: [] };
    case 'prep':
      return { items: [] };
    case 'sources':
      return { rows: [], total_cap: null, note: null };
    case 'notes':
      return { text: '', text_ko: null };
  }
}

const REASON: Record<SectionKind, string> = {
  rewards: 'Every reward needs a name and a kind.',
  stages: 'Every group needs a name, every stage a number, every drop an item and a quantity.',
  point_table: 'Every row needs an action and a number of points.',
  prep: 'Every row needs an item, and a unit above zero.',
  sources: 'Every row needs a source.',
  notes: 'Notes need some text.',
};

const NOT_A_NUMBER = 'A number field holds something that is not a number.';

/** A NaN anywhere in the draft: a number input holding text. Looked for
 * before parsing, because the validators treat a bad OPTIONAL number as
 * absent, and saving "cap: lots" as "no cap" would be a silent change. */
function hasNaN(value: unknown): boolean {
  if (typeof value === 'number') return Number.isNaN(value);
  if (Array.isArray(value)) return value.some(hasNaN);
  if (typeof value === 'object' && value !== null) return Object.values(value).some(hasNaN);
  return false;
}

export type DraftResult = { ok: true; section: SectionPayload } | { ok: false; reason: string };

/** Whether a draft may be saved, and the sentence to show when it may not. */
export function validateDraft(kind: SectionKind, payload: unknown): DraftResult {
  if (hasNaN(payload)) return { ok: false, reason: NOT_A_NUMBER };
  const section = parseSection(kind, payload);
  return section === null ? { ok: false, reason: REASON[kind] } : { ok: true, section };
}

export function setAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, at) => (at === index ? value : item));
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, at) => at !== index);
}

/** The item one place up (-1) or down (+1); unchanged at either end. */
export function moveAt<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [moved] = out.splice(index, 1);
  out.splice(to, 0, moved as T);
  return out;
}

/** A search box's text as something safe to put inside a PostgREST `or()`:
 * commas, brackets, wildcards, quotes and backslashes are filter syntax there,
 * so they become spaces. Null under two characters — one letter matches half
 * the catalogue. */
export function searchFilter(text: string): string | null {
  const cleaned = text
    .replace(/[,()%*"'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length < 2 ? null : cleaned;
}

/** A number input's text: empty is "not set", anything unreadable is NaN so
 * the draft fails validation instead of losing the field. */
export function numberOrUndefined(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}
