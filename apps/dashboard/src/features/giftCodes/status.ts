import type { GiftCode, GiftMember } from './data';

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

/** `R4`, or a dash where the rank is not known. */
export function rankLabel(rank: number | null): string {
  return rank === null ? '\u2014' : `R${rank}`;
}

/** The roster in the order the picker reads: highest rank first, then by name,
 * with those whose rank is not known last. */
export function byRank<T extends Pick<GiftMember, 'rank' | 'name'>>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => {
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
  for (const rank of [5, 4, 3, 2, 1, null] as const) {
    const inGroup = members.filter((m) => (rank === null ? m.rank === null : m.rank === rank));
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
