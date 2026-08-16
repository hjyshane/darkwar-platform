// Codes get read aloud and typed by hand, so the alphabet leaves out the
// pairs that get confused doing that: 0/O, 1/I/L, 2/Z, 5/S, 8/B. What is
// left is 23 symbols, and a 10-character code from it is ~45 bits — far
// past guessing, given redeem_join_code() also locks a caller out after
// five wrong tries (0021).
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
const LENGTH = 10;
const GROUP = 5;

/** A code that survives being dictated over voice chat. */
export function generateJoinCode(random: Crypto = crypto): string {
  const bytes = new Uint8Array(LENGTH);
  random.getRandomValues(bytes);
  // Rejection is not needed: 256 % 25 leaves a small bias, and the bias
  // costs a fraction of a bit against an attacker who must already hold an
  // account and gets five attempts an hour.
  const body = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${body.slice(0, GROUP)}-${body.slice(GROUP)}`;
}

export type CodeState = 'active' | 'revoked' | 'expired' | 'used up';

/** What a code is doing right now.
 *
 * The order matters: a revoked code that also expired reads as revoked,
 * because that is the fact somebody acted on. Mirrors the conditions
 * redeem_join_code() checks, so this screen cannot claim a code works when
 * the database would refuse it.
 */
export function codeState(
  code: {
    revoked_at: string | null;
    expires_at: string | null;
    max_uses: number | null;
    used_count: number;
  },
  now: Date,
): CodeState {
  if (code.revoked_at !== null) {
    return 'revoked';
  }
  if (code.expires_at !== null && new Date(code.expires_at) <= now) {
    return 'expired';
  }
  if (code.max_uses !== null && code.used_count >= code.max_uses) {
    return 'used up';
  }
  return 'active';
}

/** Remaining redemptions, or null when a code has no limit. */
export function usesLeft(code: { max_uses: number | null; used_count: number }): number | null {
  return code.max_uses === null ? null : Math.max(0, code.max_uses - code.used_count);
}

/** How many characters each half of a code holds. Exported so the form's two
 * boxes and this file cannot disagree about where the hyphen goes. */
export const CODE_GROUP = GROUP;

/** One half of a typed code, cleaned up.
 *
 * UPPERCASED, AND THAT IS SAFE RATHER THAN LENIENT: every code ever issued
 * comes from `generateJoinCode`, whose alphabet is uppercase by construction,
 * and `redeem_join_code` compares with `=`. So a lowercase code is always a
 * typing choice, never a different code — folding it costs nothing and saves
 * the member a failed attempt against a five-try lockout.
 *
 * Characters outside the alphabet are dropped rather than rejected. The
 * hyphen is the reason: somebody pasting or typing `ABCDE-FGHIJ` into the
 * first box should not be told off, and the confusable pairs the alphabet
 * excludes (O/0, I/1) are exactly what a person mistypes reading one aloud.
 */
export function cleanCodePart(raw: string): string {
  return [...raw.toUpperCase()]
    .filter((character) => ALPHABET.includes(character))
    .join('')
    .slice(0, CODE_GROUP);
}

/** The two boxes as the single code the function expects. */
export function joinCodeFrom(first: string, second: string): string {
  return `${cleanCodePart(first)}-${cleanCodePart(second)}`;
}

/** Whether both halves are full, so the form can enable its button. */
export function isCodeComplete(first: string, second: string): boolean {
  return cleanCodePart(first).length === CODE_GROUP && cleanCodePart(second).length === CODE_GROUP;
}

/** Split something pasted into the first box across both halves.
 *
 * Pasting the whole code is the common case — it arrives in a Discord message
 * as `ABCDE-FGHIJ` — and typing it is the fallback, not the other way round.
 */
export function splitPastedCode(raw: string): [string, string] {
  const cleaned = [...raw.toUpperCase()]
    .filter((character) => ALPHABET.includes(character))
    .join('');
  return [cleaned.slice(0, CODE_GROUP), cleaned.slice(CODE_GROUP, CODE_GROUP * 2)];
}
