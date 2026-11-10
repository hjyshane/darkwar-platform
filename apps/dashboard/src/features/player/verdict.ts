// The one sentence at the top of a profile: who this is in figures.
//
// Every clause states a fact we hold and names its source number; a clause
// whose data is missing is dropped, never replaced with filler. Figures come
// out as their own segments so the page can set them in `Verdict`'s code
// style — the composition is pure and tested here, the markup is phase B.

import { compactNumber } from '../../lib/compactNumber';
import type { ServerRankFacts } from './serverRank';

/** How old the newest world read may be before "shield off" stops being an
 * answer worth printing. A week: beyond that the sighting predates whatever
 * the player did since, and the LED already says "no map read in 7 days". */
export const SHIELD_READ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The newest `world_city_snapshots` sighting, as the verdict needs it. */
export interface ShieldFacts {
  readAt: string;
  /** When the shield ends, as of that sighting; null when never shielded. */
  shieldEndAt: string | null;
}

/** A board the game itself ranks (hero and pet totals, 0018), named by the
 * noun the sentence uses: "heroes #2". */
export interface RankedBoard {
  noun: string;
  rank: number;
}

export interface VerdictFacts {
  serverId: number;
  rank: ServerRankFacts | null;
  shield: ShieldFacts | null;
  boards: readonly RankedBoard[];
  now: Date;
}

export type VerdictSegment = { kind: 'text'; text: string } | { kind: 'figure'; text: string };

const text = (value: string): VerdictSegment => ({ kind: 'text', text: value });
const figure = (value: string): VerdictSegment => ({ kind: 'figure', text: value });
const power = compactNumber(1);

const day = (iso: string): string => iso.slice(0, 10);
const minute = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

function rankClause(facts: VerdictFacts): VerdictSegment[] | null {
  const rank = facts.rank;
  if (rank === null) return null;
  const server = figure(String(facts.serverId));
  if (rank.rank === 1) {
    return rank.leadOverBelow === null
      ? [text('Strongest on '), server, text('.')]
      : [
          text('Strongest on '),
          server,
          text(' by '),
          figure(power.format(rank.leadOverBelow)),
          text('.'),
        ];
  }
  const segments = [figure(`#${rank.rank}`), text(' on '), server];
  if (rank.gapToAbove !== null) {
    segments.push(
      text(', '),
      figure(power.format(rank.gapToAbove)),
      text(' behind '),
      figure(`#${rank.rank - 1}`),
    );
  }
  segments.push(text('.'));
  return segments;
}

function shieldClause(facts: VerdictFacts): VerdictSegment[] | null {
  const shield = facts.shield;
  if (shield === null) return null;
  const now = facts.now.getTime();
  if (now - new Date(shield.readAt).getTime() > SHIELD_READ_MAX_AGE_MS) return null;
  if (shield.shieldEndAt === null) return [text('Shield off.')];
  const end = new Date(shield.shieldEndAt);
  if (end.getTime() > now) {
    return [text('Shield up until '), figure(minute(end.toISOString())), text('.')];
  }
  return [text('Shield off since '), figure(day(end.toISOString())), text('.')];
}

function capitalise(noun: string): string {
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function boardClause(facts: VerdictFacts): VerdictSegment[] | null {
  if (facts.boards.length === 0) return null;
  const best = facts.boards.filter((board) => board.rank === 1);
  const rest = facts.boards.filter((board) => board.rank !== 1);
  const weakest = rest.reduce<RankedBoard | null>(
    (worst, board) => (worst === null || board.rank > worst.rank ? board : worst),
    null,
  );
  const segments: VerdictSegment[] = [];
  if (best.length > 0) {
    segments.push(
      text(best.map((board, i) => (i === 0 ? capitalise(board.noun) : board.noun)).join(', ')),
    );
    segments.push(text(' '), figure('#1'));
  }
  if (weakest !== null) {
    segments.push(text(best.length > 0 ? `; ${weakest.noun} ` : `${capitalise(weakest.noun)} `));
    segments.push(figure(`#${weakest.rank}`));
  }
  segments.push(text('.'));
  return segments;
}

/** Rank, then shield, then boards; clauses without data are absent. */
export function composeVerdict(facts: VerdictFacts): VerdictSegment[] {
  const clauses = [rankClause(facts), shieldClause(facts), boardClause(facts)].filter(
    (clause): clause is VerdictSegment[] => clause !== null,
  );
  return clauses.flatMap((clause, i) => (i === 0 ? clause : [text(' '), ...clause]));
}

/** The sentence as plain text, for tests and for `title` attributes. */
export function verdictText(segments: readonly VerdictSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}
