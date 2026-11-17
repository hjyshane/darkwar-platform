// Hive safety (0330): what the editor does when somebody else saved first,
// what a refused write is called, and how "who changed it" and "how long is
// a deleted plan kept" are written down.
//
// Pure functions, kept apart from the editor so each decision can be tested
// without rendering two thousand lines of it.

import { type Offset, offsetKey } from '../../lib/hiveFormation';
import { zonedDayKey, zonedTime } from '../../lib/timezone';

/** How long a deleted plan can be restored. The owner's choice, 2026-11-15;
 * the database's daily cleanup (0330) uses the same number. */
export const KEEP_DELETED_DAYS = 30;

/** Somebody else got there first. `version`: they saved the shape or the
 * people after this draft was built. `anchor`: they moved the anchor after
 * this officer last saw it. */
export class StaleSaveError extends Error {
  readonly kind: 'version' | 'anchor';

  constructor(kind: 'version' | 'anchor', message: string) {
    super(message);
    this.name = 'StaleSaveError';
    this.kind = kind;
  }
}

/** The plan being written to was deleted under the officer. */
export class PlanDeletedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanDeletedError';
  }
}

/** A database refusal, turned into something the screen can tell apart.
 *
 * `PT409` is what 0330's functions raise for a stale write; PostgREST answers
 * it with HTTP 409 and supabase-js passes the code through. The two kinds
 * share the code and differ in the message, which 0330 fixes. */
export function toWriteError(error: { code?: string; message: string }): Error {
  if (error.code === 'PT409') {
    return new StaleSaveError(
      error.message.includes('anchor') ? 'anchor' : 'version',
      error.message,
    );
  }
  if (error.code === 'P0002' && error.message.includes('deleted')) {
    return new PlanDeletedError(error.message);
  }
  return new Error(error.message);
}

export type DraftStatus = 'current' | 'behind' | 'conflict';

/** What to do with the editor's draft when a board arrives.
 *
 * - `current`: the board is the version the draft was built from, or older —
 *   including the officer's own save coming back, since the save's response
 *   moves `baseVersion` first. Today's rules apply.
 * - `behind`: somebody else saved and nothing here is unsaved. Take their
 *   version quietly.
 * - `conflict`: somebody else saved and there are unsaved changes. Keep them
 *   on screen; they cannot be saved over the newer plan.
 */
export function draftStatus(input: {
  unsaved: boolean;
  baseVersion: number;
  boardVersion: number;
}): DraftStatus {
  if (input.boardVersion <= input.baseVersion) {
    return 'current';
  }
  return input.unsaved ? 'conflict' : 'behind';
}

/** Which version of the plan a board was read from. A plan with no tiles has
 * no board rows to say so, and the plan row answers instead. */
export function boardVersionOf(
  slots: readonly { formationVersion: number | null }[],
  formationVersion: number,
): number {
  return slots.find((slot) => slot.formationVersion !== null)?.formationVersion ?? formationVersion;
}

/** One person on one tile, named by where the tile stands. */
export interface OffsetAssignment {
  dx: number;
  dy: number;
  player_id: string | null;
  pinned: boolean;
}

/** The people half of a save, one entry per tile.
 *
 * BY OFFSET, because a moved tile gets a new id when the shape is saved and
 * the offset is the only thing that still finds it (0330's
 * `save_hive_formation`). A tile with nobody on it is sent as empty: the
 * function empties every tile the payload leaves out anyway, and saying so
 * makes the payload read the same as the board. */
export function peopleByOffset(
  tiles: readonly Offset[],
  placements: ReadonlyMap<string, { playerId: string; pinned: boolean }>,
): OffsetAssignment[] {
  return tiles.map((tile) => {
    const placed = placements.get(offsetKey(tile));
    return {
      dx: tile.dx,
      dy: tile.dy,
      player_id: placed?.playerId ?? null,
      pinned: placed?.pinned ?? false,
    };
  });
}

/** "14:32", or "12 Nov 14:32" when it was not today — judged in the reader's
 * chosen clock, not in UTC. */
export function whenText(at: string, zone: string, now: Date): string {
  const time = zonedTime(at, zone);
  if (zonedDayKey(at, zone) === zonedDayKey(now.toISOString(), zone)) {
    return time;
  }
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  }).format(new Date(at));
  return `${day} ${time}`;
}

/** "Last changed by Mina · 14:32". */
export function stampText(name: string | null, at: string, zone: string, now: Date): string {
  return `Last changed by ${name ?? 'someone'} · ${whenText(at, zone, now)}`;
}

/** Which plan the hive screen shows.
 *
 * `plans` is ONE list, deleted plans included (officers see them; for
 * members the database leaves them out). One list rather than a live list
 * and a deleted list because the two would refresh separately, and in
 * between a plan just deleted by somebody else would be in neither — the
 * screen would move on to another plan and the officer's unsaved draft,
 * which lives in the editor for the plan on screen, would go with it.
 *
 * So: the plan picked in the picker, else the one already on screen (so a
 * different plan being made live does not swap it out from under somebody
 * drawing), else the live one, else the first. A plan on screen that has
 * been deleted stays on screen, marked `deletedUnderUs`, so the officer is
 * told and can restore it and save. A deleted plan is never what opens by
 * default. */
export function pickFormation<
  F extends { formationId: string; isActive: boolean; deletedAt: string | null },
>(input: {
  plans: readonly F[];
  chosenId: string | null;
  shownId: string | null;
}): { formation: F | null; deletedUnderUs: boolean } {
  const wanted = input.chosenId ?? input.shownId;
  const found =
    wanted === null ? undefined : input.plans.find((plan) => plan.formationId === wanted);
  if (found !== undefined) {
    return { formation: found, deletedUnderUs: found.deletedAt !== null };
  }
  const live = input.plans.filter((plan) => plan.deletedAt === null);
  return {
    formation: live.find((plan) => plan.isActive) ?? live[0] ?? null,
    deletedUnderUs: false,
  };
}

const DAY_MS = 24 * 60 * 60_000;

/** The moment the daily cleanup may remove a plan deleted at `deletedAt`. */
export function keptUntil(deletedAt: string): Date {
  return new Date(new Date(deletedAt).getTime() + KEEP_DELETED_DAYS * DAY_MS);
}

/** Whether a deleted plan can still be restored. Strictly before the 30th
 * day, matching the cleanup's `deleted_at < now() - interval '30 days'`. */
export function stillRestorable(deletedAt: string, now: Date): boolean {
  return now.getTime() < keptUntil(deletedAt).getTime();
}
