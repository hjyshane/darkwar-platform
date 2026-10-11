// The Gift Center key a member saves for their own character (0273).
//
// Pure, so what is accepted from a paste can be checked on its own. The key is
// a login token for the player's store account: nothing in here logs, stores or
// returns more than the one value that was asked for.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_PARAM = /[?&]uuid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export type KeyPaste =
  | { ok: true; key: string }
  | { ok: false; reason: 'empty' | 'none' | 'several' };

/** The key out of whatever was pasted: the whole Gift Center link, a request
 * address, or the bare value. A link's `uuid=` wins; otherwise there must be
 * exactly one UUID in the text, because picking one of several would be a guess
 * about somebody's login token. */
export function extractGiftKey(pasted: string): KeyPaste {
  const text = pasted.trim();
  if (text === '') {
    return { ok: false, reason: 'empty' };
  }
  const param = UUID_PARAM.exec(text);
  if (param?.[1]) {
    return { ok: true, key: param[1].toLowerCase() };
  }
  const found = new Set((text.match(UUID) ?? []).map((value) => value.toLowerCase()));
  if (found.size === 0) {
    return { ok: false, reason: 'none' };
  }
  if (found.size > 1) {
    return { ok: false, reason: 'several' };
  }
  return { ok: true, key: [...found][0] as string };
}

export function pasteProblem(result: Exclude<KeyPaste, { ok: true }>): string {
  switch (result.reason) {
    case 'empty':
      return 'Paste your Gift Center link, or the key from it.';
    case 'none':
      return 'No key found there. It looks like 8-4-4-4-12 letters and digits, after uuid= in the link.';
    case 'several':
      return 'More than one key in that text. Paste only your own link.';
  }
}
