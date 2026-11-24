// The alliance header's one-paragraph reading, composed from facts the page
// already has. Every clause is dropped when its data is missing; the result
// is '' when nothing is known, and the header then shows no verdict.

import { compactNumber } from '../../lib/compactNumber';
import { type Translate, english } from '../../lib/i18n/core';

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

/** A translated sentence as parts: each `{name}` in `figures` becomes a figure,
 * each in `vars` running text, so the sentence stays whole in every language
 * and the figures still land in `<code>` wherever its grammar puts them. */
function sentence(
  template: string,
  figures: Readonly<Record<string, string>>,
  vars: Readonly<Record<string, string | number>> = {},
): VerdictPart[] {
  const parts: VerdictPart[] = [];
  for (const piece of template.split(/(\{\w+\})/)) {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    if (name !== undefined && name in figures) {
      parts.push(fig(figures[name] as string));
    } else if (name !== undefined && name in vars) {
      parts.push(text(String(vars[name])));
    } else if (piece !== '') {
      parts.push(text(piece));
    }
  }
  return parts;
}

function tagged(neighbour: Neighbour, t: Translate): string {
  return neighbour.tag ? `[${neighbour.tag}]` : t('the next alliance');
}

/** The distance to the neighbour that matters: the lead over second place for
 * the leader, the gap to the place above for everybody else. Null when either
 * power was never read. */
function gap(
  facts: AllianceVerdictFacts,
  t: Translate,
): { amount: string; ahead: boolean; alliance: string } | null {
  if (facts.rank === null || facts.power === null) return null;
  if (facts.rank === 1 && facts.below?.power != null) {
    return {
      amount: figure.format(facts.power - facts.below.power),
      ahead: true,
      alliance: tagged(facts.below, t),
    };
  }
  if (facts.rank > 1 && facts.above?.power != null) {
    return {
      amount: figure.format(facts.above.power - facts.power),
      ahead: false,
      alliance: tagged(facts.above, t),
    };
  }
  return null;
}

/** The gap as one phrase, for the rank cell's context line: `1.2G behind [ADET]`. */
export function standingGap(facts: AllianceVerdictFacts, t: Translate = english): string | null {
  const found = gap(facts, t);
  if (found === null) return null;
  const vars = { amount: found.amount, alliance: found.alliance };
  return found.ahead
    ? t('{amount} ahead of {alliance}', vars)
    : t('{amount} behind {alliance}', vars);
}

function standing(facts: AllianceVerdictFacts, t: Translate): VerdictPart[] {
  if (facts.rank === null || facts.total === null || facts.serverId === null) return [];
  const rank = `#${facts.rank}`;
  const vars = { total: facts.total, server: facts.serverId };
  const found = gap(facts, t);
  if (found === null) {
    return sentence(t('{rank} of {total} alliances on {server}.'), { rank }, vars);
  }
  const all = { ...vars, alliance: found.alliance };
  return sentence(
    found.ahead
      ? t('{rank} of {total} alliances on {server}, {amount} ahead of {alliance}.')
      : t('{rank} of {total} alliances on {server}, {amount} behind {alliance}.'),
    { rank, amount: found.amount },
    all,
  );
}

function rules(facts: AllianceVerdictFacts, t: Translate): VerdictPart[] {
  const power = facts.minPower === null ? null : figure.format(facts.minPower);
  const hq = facts.minHq === null ? null : `HQ ${facts.minHq}`;
  const minimums =
    power !== null && hq !== null
      ? sentence(t('{power} and {hq} minimum.'), { power, hq })
      : power !== null
        ? sentence(t('{power} minimum.'), { power })
        : hq !== null
          ? sentence(t('{hq} minimum.'), { hq })
          : [];
  if (facts.joinRule === null) return minimums;
  if (minimums.length === 0) {
    return [text(facts.joinRule === 'approval' ? t('Joins need approval.') : t('Open join.'))];
  }
  const join = facts.joinRule === 'approval' ? t('Joins need approval') : t('Open join');
  return [text(join), text(' · '), ...minimums];
}

/** The verdict as parts, the standing sentence then the join rules, either
 * dropped when its data is missing. Empty when nothing is known. */
export function verdictParts(facts: AllianceVerdictFacts, t: Translate = english): VerdictPart[] {
  const first = standing(facts, t);
  const second = rules(facts, t);
  return first.length > 0 && second.length > 0
    ? [...first, text(' '), ...second]
    : [...first, ...second];
}

export function composeAllianceVerdict(
  facts: AllianceVerdictFacts,
  t: Translate = english,
): string {
  return verdictParts(facts, t)
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
