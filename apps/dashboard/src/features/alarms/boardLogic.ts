import type { AlarmBoard } from './alarmLogic';

/** The boards panel's rules, with no database in sight: a new board's key,
 * which game events may be watched, and what removing a board does. */

/** A key from a label, once.
 *
 * The key is a primary key that `schedule_events.category` points at, so
 * re-deriving it on every rename would orphan every entry already filed under
 * the old one. Derived rather than typed because nobody adding "Bear hunt"
 * should have to think about what a slug is — and a collision just gets a
 * suffix rather than an error about a duplicate key.
 *
 * (From the archived Schedule screen, `schedule.ts` at b7aee267.) `taken` is
 * the boards of the alliance on screen: 0203 makes a key unique per alliance.
 * A derived key never contains `_`, so it cannot land on a game board's
 * `game_…` key.
 */
export function categoryKey(label: string, taken: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'board';
  if (!taken.includes(base)) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
}

/** Calendar activities whose entries come from the alliance's PICKS (0249),
 * never from the calendar window (spec §2: "the calendar windows for these two
 * activities are not turned into entries"). Watching one would file the
 * game's two-day window beside the picked time — two entries, two sets of
 * alarms. Ids from the 11-12 calendar capture (Zombie Siege 41008,
 * `plan/website-restructure-2026-11.md` §9) and the client tables (Bio-Mutant,
 * the repo's Frankie, is 111401/66008: `docs/log/2026-10.md`). */
const PICKED_ACTIVITIES: ReadonlySet<string> = new Set(['41008', '111401', '66008']);

/** The boards 0249/0326 file the picks on. The next pick reading creates a
 *  missing one again (`on conflict do nothing`), with default settings. */
const PICK_BOARDS: ReadonlySet<string> = new Set([
  'game_zombie_siege',
  'game_bio_mutant',
  'game_black_gold',
]);

/** "Watch a game event": one option per activity (the calendar lists one per
 *  window), none already watched, none the picks cover. */
export function watchableEvents<T extends { activityId: string }>(
  events: readonly T[],
  boards: readonly Pick<AlarmBoard, 'activityId'>[],
): T[] {
  const watched = new Set(boards.map((board) => board.activityId));
  return [
    ...new Map(
      events
        .filter((event) => !watched.has(event.activityId))
        .filter((event) => !PICKED_ACTIVITIES.has(event.activityId))
        .map((event) => [event.activityId, event]),
    ).values(),
  ];
}

export interface RemoveBoardText {
  action: string;
  confirm: string;
  yes: string;
}

/** What removing a board is called, and what the officer is told first.
 *
 * Deleting a board leaves its entries (0203: `on delete set null (category)`)
 * and their alarms, which then go to the alliance's reminder channel, as any
 * board-less entry's do. A watched game event is un-watched this way: with no
 * board following the activity, 0325 files nothing new for it.
 */
export function removeBoardText(
  board: Pick<AlarmBoard, 'category' | 'label' | 'activityId'>,
): RemoveBoardText {
  const entries =
    'Entries already listed keep their alarms; with no board, they go to the alliance reminder channel.';
  if (board.activityId !== null) {
    return {
      action: 'Stop watching',
      confirm: `Stop watching ${board.label}? The game's calendar files no new entries for it. ${entries}`,
      yes: 'Yes, stop watching',
    };
  }
  const back = PICK_BOARDS.has(board.category)
    ? " The game puts it back, with default settings, the next time it reads the alliance's picks."
    : '';
  return {
    action: 'Delete board',
    confirm: `Delete the board ${board.label}? ${entries}${back}`,
    yes: 'Yes, delete',
  };
}
