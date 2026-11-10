// The alliance header's one-paragraph reading, composed from facts the page
// already has. Every clause is dropped when its data is missing; the result
// is '' when nothing is known, and the header then shows no verdict.

import { compactNumber } from '../../lib/compactNumber';

export interface Neighbour {
  tag: string | null;
  power: number | null;
}

export interface AllianceVerdictFacts {
  rank: number | null;
  total: number | null;
  serverId: number | null;
  power: number | null;
  /** The alliance one place above; null when this one leads or the standing is unknown. */
  above: Neighbour | null;
  /** The alliance one place below; used for the lead when this one leads. */
  below: Neighbour | null;
  /** null until joinApproval's meaning is confirmed (0313 column comment). */
  joinRule: 'approval' | 'open' | null;
  minPower: number | null;
  minHq: number | null;
}

const figure = compactNumber(1);

/** A piece of the verdict. Figures are the numbers a reader scans for; the
 * header sets them in `<code>`, everything else is running text. */
export interface VerdictPart {
  kind: 'text' | 'figure';
  text: string;
}

const text = (value: string): VerdictPart => ({ kind: 'text', text: value });
const fig = (value: string): VerdictPart => ({ kind: 'figure', text: value });

function tagged(neighbour: Neighbour): string {
  return neighbour.tag ? `[${neighbour.tag}]` : 'the next alliance';
}

/** The distance to the neighbour that matters: the lead over second place for
 * the leader, the gap to the place above for everybody else. Null when either
 * power was never read. */
function gap(facts: AllianceVerdictFacts): { amount: string; rest: string } | null {
  if (facts.rank === null || facts.power === null) return null;
  if (facts.rank === 1 && facts.below?.power != null) {
    return {
      amount: figure.format(facts.power - facts.below.power),
      rest: ` ahead of ${tagged(facts.below)}`,
    };
  }
  if (facts.rank > 1 && facts.above?.power != null) {
    return {
      amount: figure.format(facts.above.power - facts.power),
      rest: ` behind ${tagged(facts.above)}`,
    };
  }
  return null;
}

/** The gap as one phrase, for the rank cell's context line: `1.2G behind [ADET]`. */
export function standingGap(facts: AllianceVerdictFacts): string | null {
  const found = gap(facts);
  return found === null ? null : `${found.amount}${found.rest}`;
}

function standing(facts: AllianceVerdictFacts): VerdictPart[] {
  if (facts.rank === null || facts.total === null || facts.serverId === null) return [];
  const parts = [fig(`#${facts.rank}`), text(` of ${facts.total} alliances on ${facts.serverId}`)];
  const found = gap(facts);
  if (found !== null) parts.push(text(', '), fig(found.amount), text(found.rest));
  parts.push(text('.'));
  return parts;
}

function rules(facts: AllianceVerdictFacts): VerdictPart[] {
  const minimums: VerdictPart[] = [];
  if (facts.minPower !== null) minimums.push(fig(figure.format(facts.minPower)));
  if (facts.minHq !== null) {
    if (minimums.length > 0) minimums.push(text(' and '));
    minimums.push(fig(`HQ ${facts.minHq}`));
  }
  const join =
    facts.joinRule === 'approval'
      ? 'Joins need approval'
      : facts.joinRule === 'open'
        ? 'Open join'
        : null;
  if (join === null && minimums.length === 0) return [];
  const parts: VerdictPart[] = [];
  if (join !== null) parts.push(text(join));
  if (join !== null && minimums.length > 0) parts.push(text(' · '));
  if (minimums.length > 0) parts.push(...minimums, text(' minimum'));
  parts.push(text('.'));
  return parts;
}

/** The verdict as parts, the standing sentence then the join rules, either
 * dropped when its data is missing. Empty when nothing is known. */
export function verdictParts(facts: AllianceVerdictFacts): VerdictPart[] {
  const first = standing(facts);
  const second = rules(facts);
  return first.length > 0 && second.length > 0
    ? [...first, text(' '), ...second]
    : [...first, ...second];
}

export function composeAllianceVerdict(facts: AllianceVerdictFacts): string {
  return verdictParts(facts)
    .map((part) => part.text)
    .join('');
}

export interface StandingRow {
  alliance_id: string | null;
  power: number | null;
  code: string | null;
}

/** Rank, total and neighbours from one server's `alliance_latest` rows.
 *
 * Power descending, a missing power sorting last; an alliance that is not in
 * the rows gives all nulls rather than a rank among strangers. */
export function standingFacts(
  rows: readonly StandingRow[],
  allianceId: string,
): Pick<AllianceVerdictFacts, 'rank' | 'total' | 'power' | 'above' | 'below'> {
  const ordered = [...rows].sort((a, b) => {
    if (a.power === null && b.power === null) return 0;
    if (a.power === null) return 1;
    if (b.power === null) return -1;
    return b.power - a.power;
  });
  const index = ordered.findIndex((row) => row.alliance_id === allianceId);
  if (index === -1) return { rank: null, total: null, power: null, above: null, below: null };
  const neighbour = (row: StandingRow | undefined): Neighbour | null =>
    row === undefined ? null : { tag: row.code, power: row.power };
  return {
    rank: index + 1,
    total: ordered.length,
    power: ordered[index]?.power ?? null,
    above: neighbour(ordered[index - 1]),
    below: neighbour(ordered[index + 1]),
  };
}
