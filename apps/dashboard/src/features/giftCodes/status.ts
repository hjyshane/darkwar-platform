import type { GiftCode, GiftMember, GiftRunner } from './data';

/** What one (code, player) pair is, in words. Unknown statuses are shown as
 * they come: a status this page does not know yet is the worker's news, not
 * something to hide behind a dash. */
export function claimLabel(status: string | undefined): string {
  switch (status) {
    case undefined:
      return '—';
    case 'queued':
      return 'waiting';
    case 'running':
      return 'sending';
    case 'done':
      return 'received';
    case 'already':
      return 'had it';
    case 'expired':
      return 'expired';
    case 'invalid':
      return 'not a code';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return status;
  }
}

/** Whether a code may still be claimed. Expired and invalid ones may not. */
export function isLive(code: Pick<GiftCode, 'status'>): boolean {
  return code.status === 'unverified' || code.status === 'working';
}

export interface CodeSummary {
  /** Players who have the reward, newly or already. */
  received: number;
  /** Players still to be sent a request for. */
  waiting: number;
  failed: number;
  /** Players without the reward and with nothing in flight: never queued, or
   * cancelled, or the code was refused. What a "claim" press would pick up. */
  untouched: number;
}

/** "55 of 68", from the counts one `gift_code_progress` row carries. */
export function summarise(code: GiftCode): CodeSummary {
  const received = code.done + code.already;
  const waiting = code.queued + code.running;
  return {
    received,
    waiting,
    failed: code.failed,
    untouched: Math.max(0, code.members - received - waiting - code.failed),
  };
}

/** The members a "claim for the selected" press would queue: selected, and not
 * excluded. The database applies the same rule; this is so the button can say
 * how many it will be, before it is pressed. */
export function claimableSelection(
  members: ReadonlyArray<GiftMember>,
  selected: ReadonlySet<number>,
): number[] {
  return members.filter((m) => selected.has(m.game_uid) && !m.excluded).map((m) => m.game_uid);
}

export type RunnerView =
  | { kind: 'on'; text: string }
  | { kind: 'paused'; text: string }
  | { kind: 'stopped'; text: string }
  | { kind: 'off'; text: string };

/** What the sender is doing, in words, from `gift_runner_status`.
 *
 * "Off with a reason" is the sender stopping ITSELF (a block, a challenge, an
 * answer nobody recognises) and is shown as stopped, because that is the case
 * that needs a person to look before turning it back on. */
export function runnerView(runner: GiftRunner, now: Date): RunnerView {
  if (runner.enabled) {
    const until = runner.paused_until ? new Date(runner.paused_until) : null;
    if (until && until.getTime() > now.getTime()) {
      const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
      return {
        kind: 'paused',
        text: `Waiting ${minutes} min: the Gift Center is not answering normally.`,
      };
    }
    return {
      kind: 'on',
      text: 'On: waiting claims are sent one at a time, even with every PC off.',
    };
  }
  if (runner.halted_reason && runner.halted_reason !== 'turned off by an officer') {
    return { kind: 'stopped', text: `Stopped itself: ${runner.halted_reason}` };
  }
  return { kind: 'off', text: 'Off: claims you queue wait until you turn this on.' };
}

/** `R4`, or a dash where the rank is not known. */
export function rankLabel(rank: number | null): string {
  return rank === null ? '\u2014' : `R${rank}`;
}

/** The roster in the order the picker reads: highest rank first, then by name,
 * with those whose rank is not known last. */
export function byRank<T extends Pick<GiftMember, 'rank' | 'name' | 'extra'>>(
  members: readonly T[],
): T[] {
  return [...members].sort((a, b) => {
    // Saved IDs come after the roster, whatever the ranks.
    if (a.extra !== b.extra) return a.extra ? 1 : -1;
    if (a.rank === null && b.rank !== null) return 1;
    if (a.rank !== null && b.rank === null) return -1;
    return (b.rank ?? 0) - (a.rank ?? 0) || a.name.localeCompare(b.name);
  });
}

export interface RankGroup {
  /** `R5`..`R1`, or `No rank`. */
  label: string;
  rank: number | null;
  /** Everybody in the group who can be picked: left-out players cannot. */
  uids: number[];
  /** How many are in the group, left-out ones included. */
  total: number;
}

/** The groups the picker offers, R5 down to R1 and then those with no rank
 * known. A group nobody in it can be picked from is left out, so there is no
 * button that does nothing. */
export function rankGroups(members: ReadonlyArray<GiftMember>): RankGroup[] {
  const groups: RankGroup[] = [];
  const roster = members.filter((m) => !m.extra);
  for (const rank of [5, 4, 3, 2, 1, null] as const) {
    const inGroup = roster.filter((m) => (rank === null ? m.rank === null : m.rank === rank));
    const uids = inGroup.filter((m) => !m.excluded).map((m) => m.game_uid);
    if (uids.length > 0) {
      groups.push({
        label: rank === null ? 'No rank' : `R${rank}`,
        rank,
        uids,
        total: inGroup.length,
      });
    }
  }
  const saved = members.filter((m) => m.extra);
  const savedUids = saved.filter((m) => !m.excluded).map((m) => m.game_uid);
  if (savedUids.length > 0) {
    groups.push({ label: 'Saved IDs', rank: null, uids: savedUids, total: saved.length });
  }
  return groups;
}

/** Everybody who can be picked: the whole roster but the players left out. */
export function pickableUids(members: ReadonlyArray<GiftMember>): number[] {
  return members.filter((m) => !m.excluded).map((m) => m.game_uid);
}

/** Whether every one of `uids` is already selected (and there is something to be). */
export function allSelected(selected: ReadonlySet<number>, uids: readonly number[]): boolean {
  return uids.length > 0 && uids.every((uid) => selected.has(uid));
}

/** A press on a group: select them all, or, when they all are already, take them
 * out again. The rest of the selection is left as it was, so groups add up. */
export function toggleGroup(selected: ReadonlySet<number>, uids: readonly number[]): Set<number> {
  const next = new Set(selected);
  if (allSelected(selected, uids)) {
    for (const uid of uids) next.delete(uid);
  } else {
    for (const uid of uids) next.add(uid);
  }
  return next;
}

export interface ParsedUids {
  uids: number[];
  /** What was typed that is not a usable player ID, as typed. */
  rejected: string[];
}

/** Player IDs out of pasted text: separated by spaces, commas, semicolons or new
 * lines. An ID is 10 to 18 digits; anything else is handed back as rejected
 * rather than guessed at. Repeats are collapsed, order is kept. */
export function parseUids(text: string): ParsedUids {
  const seen = new Set<number>();
  const rejected: string[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (token === '') continue;
    const value = /^[0-9]{10,18}$/.test(token) ? Number(token) : Number.NaN;
    if (!Number.isSafeInteger(value)) {
      rejected.push(token);
    } else {
      seen.add(value);
    }
  }
  return { uids: [...seen], rejected };
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `text` is a UUID, which is what a player's Gift Center key looks like. */
export function isUuid(text: string): boolean {
  return UUID_SHAPE.test(text.trim());
}

export interface PlayerEntry {
  uid: number;
  /** The player's Gift Center key, when one was given with the ID. */
  key: string | null;
}

export interface ParsedPlayers {
  entries: PlayerEntry[];
  /** What was typed that is neither a usable player ID nor a key that follows one. */
  rejected: string[];
}

/** Players out of pasted text: a player ID, optionally followed by that
 * player's key (a UUID). Spaces, commas, semicolons and new lines all separate.
 * `1135062125000580 3f2b8c1e-...` is one player with a key; a lone ID is a player
 * without one. A key with no ID before it is handed back as rejected. */
export function parsePlayerLines(text: string): ParsedPlayers {
  const byUid = new Map<number, PlayerEntry>();
  const rejected: string[] = [];
  let last: PlayerEntry | null = null;
  for (const token of text.split(/[\s,;]+/)) {
    if (token === '') continue;
    if (isUuid(token)) {
      if (last !== null && last.key === null) {
        last.key = token.toLowerCase();
      } else {
        rejected.push(token);
      }
      continue;
    }
    const value = /^[0-9]{10,18}$/.test(token) ? Number(token) : Number.NaN;
    if (!Number.isSafeInteger(value)) {
      rejected.push(token);
      last = null;
      continue;
    }
    let entry = byUid.get(value);
    if (entry === undefined) {
      entry = { uid: value, key: null };
      byUid.set(value, entry);
    }
    last = entry;
  }
  return { entries: [...byUid.values()], rejected };
}
