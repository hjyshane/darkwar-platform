// The small validator the section schemas share (0309).
//
// No zod in this repo: payloads are checked by hand, the way lib/seasonLab.ts
// and lib/rankMinimums.ts check a setting. Every helper returns null for
// "not that shape" so a parser can `if (x === null) return null` and a
// payload is either whole or rejected — never half an object.

export const SECTION_KINDS = [
  'rewards',
  'stages',
  'point_table',
  'prep',
  'sources',
  'notes',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export function isSectionKind(value: unknown): value is SectionKind {
  return typeof value === 'string' && (SECTION_KINDS as readonly string[]).includes(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string. */
export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A string when present; absent and null both read as undefined. */
export function optStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A string or null — for columns that are nullable rather than optional. */
export function nullStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A finite number. Numeric strings are not numbers: a payload typed by hand
 * goes through the editor, which sends numbers. */
export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function optNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function nullNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** An integer in [lo, hi]. */
export function intIn(value: unknown, lo: number, hi: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi
    ? value
    : null;
}

/** A list where every element parses; one bad element rejects the list. */
export function list<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/** Drops keys whose value is undefined, so a parsed payload deep-equals the
 * fixture it came from instead of carrying `per: undefined`. */
export function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out as T;
}
