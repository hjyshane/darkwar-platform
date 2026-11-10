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

function tagged(neighbour: Neighbour): string {
  return neighbour.tag ? `[${neighbour.tag}]` : 'the next alliance';
}

function standing(facts: AllianceVerdictFacts): string | null {
  if (facts.rank === null || facts.total === null || facts.serverId === null) return null;
  let sentence = `#${facts.rank} of ${facts.total} alliances on ${facts.serverId}`;
  if (facts.power !== null) {
    if (facts.rank === 1 && facts.below?.power != null) {
      sentence += `, ${figure.format(facts.power - facts.below.power)} ahead of ${tagged(facts.below)}`;
    } else if (facts.rank > 1 && facts.above?.power != null) {
      sentence += `, ${figure.format(facts.above.power - facts.power)} behind ${tagged(facts.above)}`;
    }
  }
  return `${sentence}.`;
}

function rules(facts: AllianceVerdictFacts): string | null {
  const minimums: string[] = [];
  if (facts.minPower !== null) minimums.push(figure.format(facts.minPower));
  if (facts.minHq !== null) minimums.push(`HQ ${facts.minHq}`);
  const minimum = minimums.length > 0 ? `${minimums.join(' and ')} minimum` : null;
  const join =
    facts.joinRule === 'approval'
      ? 'Joins need approval'
      : facts.joinRule === 'open'
        ? 'Open join'
        : null;
  const parts = [join, minimum].filter((part): part is string => part !== null);
  return parts.length > 0 ? `${parts.join(' · ')}.` : null;
}

export function composeAllianceVerdict(facts: AllianceVerdictFacts): string {
  return [standing(facts), rules(facts)]
    .filter((sentence): sentence is string => sentence !== null)
    .join(' ');
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
