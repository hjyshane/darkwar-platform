/** How long until a season resource reaches the amount an upgrade wants.
 *
 * Nothing here touches the database. The three figures are read off the game
 * by the member and typed in — the app has no production rate for anybody, and
 * the building board carries levels rather than stockpiles. This is arithmetic
 * on the screen, kept out of the component so the awkward cases (no rate, a
 * shortfall already covered, an empty box) can be pinned by tests.
 */

/** An answer, or the reason there is not one yet. */
export type Wait =
  /** Enough already; nothing to wait for. */
  | { kind: 'ready' }
  /** A shortfall with nothing coming in. Dividing would give Infinity. */
  | { kind: 'never' }
  | { kind: 'wait'; hours: number };

export interface WaitInput {
  perHour: number | null;
  current: number | null;
  needed: number | null;
}

/** Read one box. `null` means "not a figure I can use" — an empty box, a word,
 * or a negative amount — and is deliberately NOT zero: treating a blank rate
 * as zero would answer "never" to somebody who has typed nothing yet.
 *
 * Separators are dropped because the game draws them and a pasted figure
 * carries them. `Number('1,200')` is NaN, which would silently read as blank.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,_]/g, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function waitFor({ perHour, current, needed }: WaitInput): Wait | null {
  if (perHour === null || current === null || needed === null) return null;
  const shortfall = needed - current;
  if (shortfall <= 0) return { kind: 'ready' };
  if (perHour <= 0) return { kind: 'never' };
  return { kind: 'wait', hours: shortfall / perHour };
}

const MINUTES_PER_DAY = 24 * 60;

/** "1d 2h 15m". Minutes are the smallest unit worth reading for a wait that
 * is usually hours long, and a wait under a minute still rounds up to one —
 * "0m" would read as ready. */
export function formatWait(hours: number): string {
  // Round to minutes FIRST, then split. Splitting first and rounding the
  // remainder lets 59.7 minutes print as "60m".
  const total = Math.max(1, Math.round(hours * 60));
  const days = Math.floor(total / MINUTES_PER_DAY);
  const rest = total % MINUTES_PER_DAY;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (Math.floor(rest / 60) > 0) parts.push(`${Math.floor(rest / 60)}h`);
  if (rest % 60 > 0) parts.push(`${rest % 60}m`);
  return parts.join(' ');
}
