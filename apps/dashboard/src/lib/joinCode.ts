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
