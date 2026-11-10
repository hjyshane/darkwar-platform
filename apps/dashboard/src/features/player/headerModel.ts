// What the profile header SAYS, as data: every wording, threshold and tone in
// one pure function, so the reading at the top of a player page is tested
// with fixtures and the component that draws it has nothing to decide.
//
// The rule throughout: a fact appears only when its data exists. Unknown is a
// dash or an absent line, never a zero and never filler.

import { formatCoordinate } from '@dw/ui';
import type { CellTone } from '../../components/console/Cell';
import type { LedTone } from '../../components/console/Led';
import type { Tick } from '../../components/console/Ticks';
import { compactNumber } from '../../lib/compactNumber';
import { formatAge, formatLastOnline } from '../../lib/freshness';
import { TERMS } from '../../lib/terms';
import { arenaSummary } from './arenaSummary';
import { type BoardRow, composeBoards, rankedBoards } from './composition';
import {
  type Delta,
  type HistoryRow,
  killsDelta,
  powerDelta,
  retentionWindowDays,
} from './deltaWindow';
import type { PlayerArenaEntry } from './playerArena';
import { type PlayerLocation, stateOf } from './playerLocation';
import type { ServerRankFacts } from './serverRank';
import { tenureCell } from './tenure';
import { SHIELD_READ_MAX_AGE_MS, type VerdictSegment, composeVerdict } from './verdict';

/** How old the newest power reading may be before the data light warns. */
export const DATA_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The part of the player row the header reads. */
export interface HeaderPlayer {
  serverId: number;
  hqLevel: number | null;
  power: number | null;
  kills: number | null;
  /** Decides the delta window: our rows are kept months, others days. */
  isOwnAlliance: boolean;
  onlineState: string | null;
  offlineSince: string | null;
  /** When presence was read. */
  observedAt: string | null;
  /** When the newest power reading was taken. */
  powerAt: string | null;
}

export interface HeaderInputs {
  player: HeaderPlayer;
  rank: ServerRankFacts | null;
  location: PlayerLocation | null;
  boardRows: readonly BoardRow[];
  history: readonly HistoryRow[];
  firstSeenInAlliance: string | null;
  arena: readonly PlayerArenaEntry[];
  now: Date;
}

export interface LedModel {
  key: 'shield' | 'online' | 'data';
  tone: LedTone;
  text: string;
  /** The long form, for hover: what the light is read from. */
  title: string;
}

export interface CellModel {
  label: string;
  /** Null renders as a dash. */
  value: string | null;
  unit?: string;
  context?: string;
  tone?: CellTone;
}

export interface PositionModel extends CellModel {
  /** The server whose map the context line links to; null with no sighting. */
  serverId: number | null;
  /** Seen, but more than a day ago: where they were, not where they are. */
  stale: boolean;
}

export interface HeaderModel {
  leds: LedModel[];
  verdict: VerdictSegment[];
  power: CellModel;
  rank: CellModel;
  position: PositionModel;
  kills: CellModel;
  lastSeen: CellModel;
  sixth: CellModel;
  ticks: Tick[];
  /** The day of the newest board reading, for the section label. */
  boardsAsOf: string | null;
  lineups: PlayerArenaEntry[];
}

const exact = new Intl.NumberFormat('en-US');
const compact1 = compactNumber(1);
const compact2 = compactNumber(2);

const day = (iso: string): string => iso.slice(0, 10);

/** A span as one unit: `45m`, `5h`, `3d`. Hours up to two days, so "36h left"
 * is not rounded down to "1d". */
function span(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(1, Math.floor(ms / MINUTE_MS))}m`;
  if (ms < 2 * DAY_MS) return `${Math.floor(ms / HOUR_MS)}h`;
  return `${Math.floor(ms / DAY_MS)}d`;
}

function shieldLed(location: PlayerLocation | null, now: Date): LedModel {
  const at = now.getTime();
  if (location === null) {
    return {
      key: 'shield',
      tone: 'neutral',
      text: 'NO MAP READ',
      title: 'Nobody has swept this player’s ground, so the shield is unknown.',
    };
  }
  const read = formatAge(location.capturedAt, now);
  if (at - new Date(location.capturedAt).getTime() > SHIELD_READ_MAX_AGE_MS) {
    return {
      key: 'shield',
      tone: 'neutral',
      text: 'NO MAP READ',
      title: `The last map read was ${read}, too old to say anything about the shield.`,
    };
  }
  const end = location.shieldEndAt === null ? null : new Date(location.shieldEndAt).getTime();
  if (end !== null && end > at) {
    return {
      key: 'shield',
      tone: 'ok',
      text: `SHIELD ${span(end - at)}`,
      title: `Shield up until at least ${day(new Date(end).toISOString())}, as of the map read ${read}. It can be extended.`,
    };
  }
  return {
    key: 'shield',
    tone: 'bad',
    text: end === null ? 'SHIELD OFF' : `SHIELD OFF ${span(at - end)}`,
    title: `Shield down as of the map read ${read}. It may have been raised since.`,
  };
}

function onlineLed(player: HeaderPlayer, now: Date): LedModel {
  if (player.onlineState === null) {
    return {
      key: 'online',
      tone: 'neutral',
      text: 'PRESENCE UNKNOWN',
      title: 'Presence has never been read for this player.',
    };
  }
  const title =
    player.observedAt === null
      ? 'Presence as last read.'
      : `Presence as read ${formatAge(player.observedAt, now)}.`;
  if (player.onlineState === 'online') {
    return { key: 'online', tone: 'ok', text: 'ONLINE', title };
  }
  return {
    key: 'online',
    tone: 'neutral',
    text: player.offlineSince === null ? 'OFFLINE' : `SEEN ${formatAge(player.offlineSince, now)}`,
    title,
  };
}

function dataLed(powerAt: string | null, now: Date): LedModel {
  if (powerAt === null) {
    return {
      key: 'data',
      tone: 'neutral',
      text: 'NO POWER READ',
      title: 'No power reading is held for this player.',
    };
  }
  const stale = now.getTime() - new Date(powerAt).getTime() > DATA_STALE_AFTER_MS;
  return {
    key: 'data',
    tone: stale ? 'warn' : 'ok',
    text: `DATA ${formatAge(powerAt, now)}`,
    title: stale
      ? 'The newest power reading is more than 48 hours old.'
      : 'The newest power reading is recent.',
  };
}

function signed(change: number): string {
  return `${change > 0 ? '+' : ''}${compact1.format(change)}`;
}

/** The line under a figure: the change over the window, written with the
 * window; or the day of the only reading there is. */
function deltaContext(
  delta: Delta,
  fallbackAt: string | null,
): Pick<CellModel, 'context' | 'tone'> {
  if (delta === null) {
    return fallbackAt === null ? {} : { context: `as of ${day(fallbackAt)}` };
  }
  if (delta.kind === 'asOf') {
    return { context: `as of ${day(delta.at)}` };
  }
  return {
    context: `${signed(delta.change)} · ${delta.windowDays}d`,
    tone: delta.change > 0 ? 'up' : delta.change < 0 ? 'down' : 'neutral',
  };
}

function rankCell(rank: ServerRankFacts | null): CellModel {
  if (rank === null) return { label: TERMS.serverRank, value: null };
  const context =
    rank.rank === 1
      ? rank.leadOverBelow === null
        ? undefined
        : `${compact1.format(rank.leadOverBelow)} over #2`
      : rank.gapToAbove === null
        ? undefined
        : `${compact1.format(rank.gapToAbove)} to #${rank.rank - 1}`;
  return {
    label: TERMS.serverRank,
    value: `#${exact.format(rank.rank)}`,
    // "Of the players we have read", which is what the total counts.
    unit: `/${exact.format(rank.total)}`,
    context,
  };
}

function positionCell(location: PlayerLocation | null, now: Date): PositionModel {
  const state = stateOf(location, now);
  if (state.kind === 'unknown') {
    return {
      label: TERMS.location,
      value: null,
      context: 'not scanned',
      serverId: null,
      stale: false,
    };
  }
  const stale = state.kind === 'stale';
  return {
    label: TERMS.location,
    value: formatCoordinate(state.at),
    context: stale
      ? `server ${state.at.serverId} · ${formatAge(state.at.capturedAt, now)}`
      : `server ${state.at.serverId}`,
    serverId: state.at.serverId,
    stale,
  };
}

function sixthCell(firstSeenInAlliance: string | null, hqLevel: number | null, now: Date) {
  const cell = tenureCell(firstSeenInAlliance, hqLevel, now);
  if (cell === null) return { label: TERMS.hq, value: null };
  if (cell.kind === 'hq') return { label: TERMS.hq, value: String(cell.level) };
  return { label: 'In alliance', value: `${cell.days}d`, context: `since ${day(cell.since)}` };
}

export function buildHeaderModel(inputs: HeaderInputs): HeaderModel {
  const { player, rank, location, now } = inputs;
  const windowDays = retentionWindowDays(player.isOwnAlliance);
  const boards = composeBoards(inputs.boardRows, player.power);

  const ticks: Tick[] = boards.map((board) => ({
    key: board.metric,
    label: board.noun,
    value: compact2.format(board.value),
    share: board.share ?? undefined,
    rank: board.rank ?? undefined,
  }));
  const boardsAsOf = boards.reduce<string | null>(
    (newest, board) => (newest === null || board.capturedAt > newest ? board.capturedAt : newest),
    null,
  );

  return {
    leds: [shieldLed(location, now), onlineLed(player, now), dataLed(player.powerAt, now)],
    verdict: composeVerdict({
      serverId: player.serverId,
      rank,
      shield:
        location === null
          ? null
          : { readAt: location.capturedAt, shieldEndAt: location.shieldEndAt },
      boards: rankedBoards(boards),
      now,
    }),
    power: {
      label: TERMS.power,
      value: player.power === null ? null : exact.format(player.power),
      ...deltaContext(powerDelta(inputs.history, windowDays), player.powerAt),
    },
    rank: rankCell(rank),
    position: positionCell(location, now),
    kills: {
      label: TERMS.kills,
      value: player.kills === null ? null : exact.format(player.kills),
      // No fallback date: the kills figure on the player row carries no
      // reading time of its own.
      ...deltaContext(killsDelta(inputs.history, windowDays), null),
    },
    lastSeen: {
      label: TERMS.lastOnline,
      value: formatLastOnline(player.onlineState, player.offlineSince, now),
      context: player.observedAt === null ? undefined : `read ${formatAge(player.observedAt, now)}`,
    },
    sixth: sixthCell(inputs.firstSeenInAlliance, player.hqLevel, now),
    ticks,
    boardsAsOf: boardsAsOf === null ? null : day(boardsAsOf),
    lineups: arenaSummary(inputs.arena),
  };
}
