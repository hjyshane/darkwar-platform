// Joining with a code and saying which character you are, as one step.
//
// WHY TWO CALLS AND NOT ONE FUNCTION. A viewer cannot read `players` (0065)
// and `claim_player` refuses a viewer (0068), so the character cannot be
// looked up or linked until the code has made the account a member. The
// screen therefore asks for both at once and does them in order: redeem, then
// find the typed name among our alliances' characters and link it. If the
// name does not match exactly one character, the account is still a member
// and the picker (which can now read the roster) takes over.

import { supabase } from '../../lib/supabase';

/** A typed name as an exact, case-insensitive `ilike` pattern. */
export function exactLike(name: string): string {
  return name.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type JoinOutcome =
  | { kind: 'refused'; message: string }
  | { kind: 'joined'; role: string; linked: string | null; note: string | null };

/** What to tell the reader when the name did not settle it. */
export function unmatchedNote(name: string, matches: number): string {
  return matches === 0
    ? `You're in, but no character in our alliances matches "${name}". Pick yours below — or ask an officer if the collector has not seen you yet.`
    : `You're in. ${matches} characters match "${name}" — pick yours below.`;
}

/** Who the reader says they are: a row picked from the roster, or text typed
 * because they are not on it yet — an in-game name or the numeric game uid. */
export type CharacterChoice =
  | { kind: 'none' }
  | { kind: 'picked'; playerId: string; name: string }
  | { kind: 'typed'; text: string };

/** A game uid is all digits and long; anything else is a name. */
export function looksLikeUid(text: string): boolean {
  return /^\d{6,}$/.test(text.trim());
}

async function findTyped(text: string): Promise<{ playerId: string; name: string }[] | null> {
  const trimmed = text.trim();
  const query = supabase
    .from('players')
    .select('player_id, current_name, alliances!players_current_alliance_id_fkey!inner(is_own)')
    .eq('alliances.is_own', true);
  const { data, error } = await (looksLikeUid(trimmed)
    ? // As text: a game uid can pass 2^53, and Number() would round it.
      query.filter('game_uid', 'eq', trimmed)
    : query.ilike('current_name', exactLike(trimmed))
  ).limit(5);
  if (error || data === null) return null;
  return data.map((row) => ({ playerId: row.player_id, name: row.current_name ?? trimmed }));
}

export async function joinAndClaim(code: string, choice: CharacterChoice): Promise<JoinOutcome> {
  const { data: role, error } = await supabase.rpc('redeem_join_code', { p_code: code });
  if (error) {
    // The lockout: about the caller, not about which codes exist (0021).
    return { kind: 'refused', message: error.message };
  }
  if (role === null) {
    // Wrong, expired, revoked and used up alike, as JoinCodeForm says.
    return { kind: 'refused', message: 'That code is not valid.' };
  }
  if (choice.kind === 'none' || (choice.kind === 'typed' && choice.text.trim() === '')) {
    return { kind: 'joined', role, linked: null, note: null };
  }

  let target: { playerId: string; name: string };
  if (choice.kind === 'picked') {
    target = { playerId: choice.playerId, name: choice.name };
  } else {
    const found = await findTyped(choice.text);
    const only = found?.length === 1 ? found[0] : undefined;
    if (only === undefined) {
      return {
        kind: 'joined',
        role,
        linked: null,
        note: unmatchedNote(choice.text.trim(), found?.length ?? 0),
      };
    }
    target = only;
  }

  const { error: claimError } = await supabase.rpc('claim_player', {
    p_player_id: target.playerId,
  });
  if (claimError) {
    return {
      kind: 'joined',
      role,
      linked: null,
      note: `You're in, but ${target.name} could not be linked: ${claimError.message}`,
    };
  }
  return { kind: 'joined', role, linked: target.name, note: null };
}
