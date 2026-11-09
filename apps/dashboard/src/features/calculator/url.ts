// The calculator's state lives in the address, so a link can be pasted into
// alliance chat: `#/calculator?kind=building&subject=409000&from=28&to=30&speed=35&cost=10`.
// Only the subject, the levels and the buff percentages go in — never stock
// or an account. Parsing is tolerant: a missing, malformed or out-of-range
// value is clamped or defaulted, never thrown on.

export const CALCULATOR_HASH = '#/calculator';

/** What the calculator can price. The planner's kinds less `pet_break` (an
 * internal split of a pet goal) plus vehicle chips (0311). Season buildings
 * are `building` with a season filter in the form, not a kind of their own. */
export const CALCULATOR_KINDS = [
  'building',
  'research',
  'hero',
  'hero_gear',
  'exclusive',
  'vehicle',
  'vehicle_part',
  'chip',
  'pet',
] as const;

export type CalculatorKind = (typeof CALCULATOR_KINDS)[number];

export interface CalculatorState {
  kind: CalculatorKind;
  /** The catalogue's subject id, or null while none is picked. */
  subject: string | null;
  /** The level the subject is at now; the steps above it are priced. */
  from: number;
  to: number;
  /** Speed bonus, percent. */
  speed: number;
  /** Cost reduction, percent. */
  cost: number;
}

export const DEFAULT_STATE: CalculatorState = {
  kind: 'building',
  subject: null,
  from: 0,
  to: 0,
  speed: 0,
  cost: 0,
};

/** Widest a buff is allowed to be in the address: a construction speed past
 * this is a typo, and a cost reduction past 100% would price a step below zero. */
const MAX_SPEED = 10_000;
const MAX_COST = 100;
/** Highest level any track reaches (buildings run to 200 in the client). */
const MAX_LEVEL = 999;

// Subjects are numeric type ids, but hero gear's is "level:q5" and the hero
// track's is "hero" — letters, digits and a colon or underscore, nothing else.
const SUBJECT = /^[A-Za-z0-9:_]{1,40}$/;

function isKind(value: string | null): value is CalculatorKind {
  return value !== null && (CALCULATOR_KINDS as ReadonlyArray<string>).includes(value);
}

/** A whole number within [0, max]; anything unreadable is `fallback`. */
function bounded(value: string | null, max: number, fallback = 0): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, Math.round(n)));
}

/** The state an address names. `#/calculator` alone is the default state; an
 * unknown kind falls back to building; `to` is never below `from`. */
export function parseCalculatorHash(hash: string): CalculatorState {
  const query = hash.indexOf('?');
  const params = new URLSearchParams(query >= 0 ? hash.slice(query + 1) : '');
  const kind = params.get('kind');
  const subject = params.get('subject');
  const from = bounded(params.get('from'), MAX_LEVEL);
  return {
    kind: isKind(kind) ? kind : DEFAULT_STATE.kind,
    subject: subject !== null && SUBJECT.test(subject) ? subject : null,
    from,
    to: Math.max(from, bounded(params.get('to'), MAX_LEVEL)),
    speed: bounded(params.get('speed'), MAX_SPEED),
    cost: bounded(params.get('cost'), MAX_COST),
  };
}

/** The address for a state. Defaults are left out so the link stays short and
 * two ways of saying the same thing give the same link. */
export function calculatorHash(state: CalculatorState): string {
  const params = new URLSearchParams();
  params.set('kind', state.kind);
  if (state.subject !== null) params.set('subject', state.subject);
  if (state.from > 0) params.set('from', String(state.from));
  if (state.to > 0) params.set('to', String(state.to));
  if (state.speed > 0) params.set('speed', String(state.speed));
  if (state.cost > 0) params.set('cost', String(state.cost));
  return `${CALCULATOR_HASH}?${params.toString()}`;
}

/** The state with its levels held inside the subject's track: `to` at most
 * `maxLevel`, `from` below `to`. Used once the subject's range is known. */
export function clampToRange(state: CalculatorState, maxLevel: number): CalculatorState {
  const top = Math.max(0, maxLevel);
  const to = Math.min(state.to, top);
  const from = Math.min(state.from, Math.max(0, to - 1), top);
  return { ...state, from, to: Math.max(to, from) };
}

/** Whether an address is the calculator's, with or without a query. */
export function isCalculatorHash(hash: string): boolean {
  return hash === CALCULATOR_HASH || hash.startsWith(`${CALCULATOR_HASH}?`);
}
