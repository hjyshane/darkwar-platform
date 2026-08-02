import type { FormulaMetric } from './overviewMetrics';

/** The figures a member formula may name.
 *
 * A formula was being written against ALLIANCE totals and shown as a tile on
 * the overview, and the one the user actually wrote was
 * `(weekly_donation * 0.4) + (duel_weekly * 0.6)` called "Activity Score" —
 * a per-member score, computed over the whole alliance and therefore the
 * same number for everybody. The names were right; the row they ran on was
 * not.
 *
 * So the vocabulary is the roster's own columns. `power` in a formula is
 * this member's power, and the result is a column beside the others rather
 * than a tile.
 */
export interface MemberField {
  /** What the formula writes. Kept as the roster's own word where it reads
   * naturally, so `weekly_donation` still means what it did. */
  id: string;
  label: string;
  /** The RosterRow key it reads. */
  column: string;
}

export const MEMBER_FIELDS: readonly MemberField[] = [
  { id: 'power', label: 'Power', column: 'power' },
  { id: 'kills', label: 'Kills', column: 'kills' },
  { id: 'hq_level', label: 'HQ level', column: 'hq_level' },
  { id: 'daily_donation', label: 'Daily donation', column: 'daily_donation_score' },
  { id: 'weekly_donation', label: 'Weekly donation', column: 'weekly_donation_score' },
  { id: 'duel_daily', label: 'Duel (daily)', column: 'duel_daily_score' },
  { id: 'duel_weekly', label: 'Duel (weekly)', column: 'duel_weekly_score' },
  { id: 'duel_round', label: 'Duel (rounds)', column: 'duel_round_score' },
];

export const MEMBER_FIELD_IDS: readonly string[] = MEMBER_FIELDS.map((field) => field.id);

/** One member's figures, keyed the way a formula names them.
 *
 * Nulls are carried through rather than replaced with zero: a member whose
 * duel score has never been observed has an unknown score, and FR-UI-008
 * says an unknown must not turn into a nought — a formula reading one comes
 * out unknown too, which is the honest answer.
 */
export function fieldsOf(row: object): Record<string, number | null> {
  const source = row as Record<string, unknown>;
  const values: Record<string, number | null> = {};
  for (const field of MEMBER_FIELDS) {
    const raw = source[field.column];
    values[field.id] = typeof raw === 'number' ? raw : null;
  }
  return values;
}

/** The settings key. Deliberately not the old `overview_formulas`: a formula
 * means something different now — it runs on a row — and silently reusing
 * the key would have made an alliance-wide expression look like a member
 * one. 0048 moves the stored value across once, on purpose. */
export const MEMBER_FORMULAS_KEY = 'member_formulas';

export type { FormulaMetric };
