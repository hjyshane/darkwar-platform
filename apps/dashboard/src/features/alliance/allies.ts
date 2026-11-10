// Allied alliances named in an intro text.
//
// Alliances write their allies as `<server> <TAG> [<TAG> ...]`, several
// groups to a line split by `/`, or one group per line: `565 RBRN / 570 SYNN
// SYN2 RYSE / 571 ZBM`. A tag only ever resolves against the alliances known
// on THAT server; the same tag on another server is a different alliance and
// is never guessed (two servers in the group both have an RBRN). Lines that
// are not entirely ally groups stay text, so a sentence that happens to start
// with a number is not turned into links.

export interface KnownAlliance {
  allianceId: string;
  serverId: number;
  code: string;
}

export type IntroSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ally'; serverId: number; tag: string; allianceId: string | null };

const TAG = '[A-Za-z0-9]{2,6}';
const GROUP = new RegExp(`^(\\d{3})(\\s+${TAG})+$`);

function lookup(known: readonly KnownAlliance[]): Map<string, string> {
  const byServerTag = new Map<string, string>();
  for (const alliance of known) {
    byServerTag.set(`${alliance.serverId}:${alliance.code.toUpperCase()}`, alliance.allianceId);
  }
  return byServerTag;
}

function parseLine(line: string, byServerTag: Map<string, string>): IntroSegment[] {
  if (line.trim() === '') return line === '' ? [] : [{ kind: 'text', text: line }];
  // Split keeping the separators so the line reproduces as written.
  const parts = line.split(/(\s*\/\s*)/);
  const groups = parts.filter((_, index) => index % 2 === 0);
  if (!groups.every((group) => GROUP.test(group.trim()))) {
    return [{ kind: 'text', text: line }];
  }
  const segments: IntroSegment[] = [];
  for (const [index, part] of parts.entries()) {
    if (index % 2 === 1) {
      segments.push({ kind: 'text', text: part });
      continue;
    }
    const tokens = part.split(/(\s+)/);
    const serverId = Number(tokens.find((token) => token.trim() !== ''));
    let seenServer = false;
    for (const token of tokens) {
      if (token === '') continue;
      if (/^\s+$/.test(token) || !seenServer) {
        segments.push({ kind: 'text', text: token });
        if (token.trim() !== '') seenServer = true;
        continue;
      }
      segments.push({
        kind: 'ally',
        serverId,
        tag: token,
        allianceId: byServerTag.get(`${serverId}:${token.toUpperCase()}`) ?? null,
      });
    }
  }
  return segments;
}

/** One array of segments per input line, in order; text lines are one segment. */
export function parseIntro(text: string, known: readonly KnownAlliance[]): IntroSegment[][] {
  if (text === '') return [];
  const byServerTag = lookup(known);
  return text.split(/\r?\n/).map((line) => parseLine(line, byServerTag));
}

/** The servers an intro names in its ally groups, ascending and distinct: the
 * only servers whose alliances need fetching to resolve its tags. */
export function namedServers(text: string): number[] {
  const servers = new Set<number>();
  for (const line of parseIntro(text, [])) {
    for (const segment of line) {
      if (segment.kind === 'ally') servers.add(segment.serverId);
    }
  }
  return [...servers].sort((a, b) => a - b);
}
