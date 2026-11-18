// Black Gold plans (0331): the pure half. Who is placed where, what a save
// sends, and what the reader is told — kept apart from the screen so each
// rule can be tested on its own.

import { OBJECTIVES } from './battlefield';

/** Every key the database accepts, in the order the editor lists them. */
export const PLAN_OBJECTIVES: ReadonlyArray<{ id: string; label: string }> = [
  ...OBJECTIVES.filter((o) => o.id !== 'hq-theirs').map((o) => ({ id: o.id, label: o.label })),
  { id: 'hq-theirs', label: 'Their headquarters' },
  { id: 'roam', label: 'Roam (no fixed spot)' },
];

export function objectiveLabel(id: string): string {
  return PLAN_OBJECTIVES.find((o) => o.id === id)?.label ?? id;
}

export interface Starter {
  playerId: string;
  name: string;
  power: number | null;
}

export interface Assignment {
  playerId: string;
  playerName: string | null;
  objectiveKey: string;
  role: string;
  ordinal: number;
}

export interface Placement {
  objectiveKey: string;
  role: string;
}

/** The editor's draft: one entry per placed starter. */
export type Draft = ReadonlyMap<string, Placement>;

/** Start a draft from what is saved, keeping only who is still a starter.
 *
 * The database refuses anybody who is not a starter of this team in the
 * newest signup reading (0331), and the game moves people between starter and
 * substitute during registration. So a saved plan can name somebody who no
 * longer qualifies; they are left out of the draft and named in `dropped`, so
 * the screen can say so instead of the save failing on them. */
export function draftFrom(
  saved: readonly Assignment[],
  starters: readonly Starter[],
): { draft: Draft; dropped: string[] } {
  const eligible = new Set(starters.map((s) => s.playerId));
  const draft = new Map<string, Placement>();
  const dropped: string[] = [];
  for (const a of [...saved].sort((x, y) => x.ordinal - y.ordinal)) {
    if (eligible.has(a.playerId)) {
      draft.set(a.playerId, { objectiveKey: a.objectiveKey, role: a.role });
    } else {
      dropped.push(a.playerName ?? 'a former starter');
    }
  }
  return { draft, dropped };
}

/** What save_bgb_plan takes, in the starters' order. */
export function payloadOf(
  draft: Draft,
  starters: readonly Starter[],
): { objective_key: string; player_id: string; role: string; ordinal: number }[] {
  const out: { objective_key: string; player_id: string; role: string; ordinal: number }[] = [];
  starters.forEach((s, index) => {
    const placed = draft.get(s.playerId);
    if (placed !== undefined) {
      out.push({
        objective_key: placed.objectiveKey,
        player_id: s.playerId,
        role: placed.role.trim().slice(0, 40),
        ordinal: index,
      });
    }
  });
  return out;
}

/** How many players go to each objective, for the numbers on the map. */
export function countsOf(placements: Iterable<{ objectiveKey: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of placements) {
    counts.set(p.objectiveKey, (counts.get(p.objectiveKey) ?? 0) + 1);
  }
  return counts;
}

/** The plan as a list per objective, objectives in map order, empty ones left
 * out — what a member reads and what gets pasted into chat. */
export function byObjective(
  assignments: readonly Assignment[],
): { objectiveKey: string; label: string; people: Assignment[] }[] {
  return PLAN_OBJECTIVES.map((o) => ({
    objectiveKey: o.id,
    label: o.label,
    people: assignments
      .filter((a) => a.objectiveKey === o.id)
      .sort((x, y) => x.ordinal - y.ordinal),
  })).filter((group) => group.people.length > 0);
}

/** Plain text for alliance chat. */
export function handout(planName: string, assignments: readonly Assignment[]): string {
  const lines = [planName];
  for (const group of byObjective(assignments)) {
    const names = group.people.map((p) =>
      p.role === '' ? (p.playerName ?? '?') : `${p.playerName ?? '?'} (${p.role})`,
    );
    lines.push(`${group.label}: ${names.join(', ')}`);
  }
  return lines.join('\n');
}

/** Has the draft moved away from what is saved? */
export function isUnsaved(draft: Draft, saved: Draft): boolean {
  if (draft.size !== saved.size) return true;
  for (const [id, p] of draft) {
    const s = saved.get(id);
    if (s === undefined || s.objectiveKey !== p.objectiveKey || s.role !== p.role) return true;
  }
  return false;
}
