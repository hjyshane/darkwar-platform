// "What it needs first", with no account open.
//
// The planner knows where an account's buildings and research stand, so it can
// say which requirements are already met. The calculator has no account; it
// has the FROM level, and that says a good deal: nobody is at Headquarters 29
// without everything Headquarters 29 asked for, and everything THAT asked for.
//
// So the standing is worked out, not asked: plan the subject from nothing up
// to `from` with prerequisites, and wherever that leaves each building and
// research is where it is taken to stand. Then the range is planned from
// there. What comes out is what the range ADDS — the Wall level the next
// Headquarters level asks for and the one before did not. A player who has
// raised something past that floor owes less; the planner, which reads the
// account, is where that is answered.
//
// THE FLOOR CAN BE RAISED. It is the least a player can have, and most have
// more: `have` names where a building or research really stands (the page
// asks, row by row), and the plan starts from the higher of the two. It is
// never lowered below the floor — the from level says that much is there.
//
// Both plans are the planner's own plan(), on one book, so a prerequisite
// costs here what it costs there.

import {
  type Goal,
  type Plan,
  type PlannedStep,
  type StepBook,
  bookKey,
  plan,
} from '../planner/plan';

/** Levels the reader says they have, by `bookKey(kind, subject)`. */
export type Have = ReadonlyMap<string, number>;

export interface Standing {
  buildings: Map<string, number>;
  research: Map<string, number>;
}

/** Where a run of steps leaves each building and research: the highest level
 * it reaches. */
export function standingAfter(steps: ReadonlyArray<PlannedStep>): Standing {
  const standing: Standing = { buildings: new Map(), research: new Map() };
  for (const { step } of steps) {
    const held =
      step.kind === 'building'
        ? standing.buildings
        : step.kind === 'research'
          ? standing.research
          : null;
    if (held !== null) {
      held.set(step.subject_id, Math.max(held.get(step.subject_id) ?? 0, step.level));
    }
  }
  return standing;
}

/** The goals as they would be asked from nothing: what a book has to hold for
 * planWithPrerequisites to work the standing out. */
export function fromNothing(goals: ReadonlyArray<Goal>): Goal[] {
  return goals.map((goal) => ({ ...goal, from: 0 }));
}

/** The goals' steps with the buildings and research they need first, taking
 * each to stand where the goals' `from` levels already required, or at the
 * level `have` gives it when that is higher. `book` must hold the goals'
 * climbs from level 0 (fromNothing). */
export function planWithPrerequisites(
  goals: ReadonlyArray<Goal>,
  book: StepBook,
  have: Have = new Map(),
): Plan {
  const nothing = new Map<string, number>();
  const before = plan(
    goals.filter((goal) => goal.from > 0).map((goal) => ({ ...goal, from: 0, to: goal.from })),
    book,
    nothing,
    true,
  );
  const standing = standingAfter(before.steps);
  for (const [key, level] of have) {
    for (const [kind, held] of [
      ['building', standing.buildings],
      ['research', standing.research],
    ] as const) {
      const prefix = bookKey(kind, '');
      if (key.startsWith(prefix)) {
        const subject = key.slice(prefix.length);
        held.set(subject, Math.max(held.get(subject) ?? 0, level));
      }
    }
  }
  return plan(goals, book, standing.buildings, true, standing.research);
}
