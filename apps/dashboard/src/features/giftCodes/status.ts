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
