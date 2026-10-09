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
