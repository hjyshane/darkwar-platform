/** Whether the first-use tour has been seen.
 *
 * Kept in localStorage, per browser: a tour is a convenience, not state worth a
 * table. Storage can throw (private window, blocked site data), and then the
 * tour simply shows again next visit, which is the safe direction to fail. */
const KEY = 'dw-tour';

export interface TourStep {
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    title: 'The menu on the left',
    body: 'Screens are grouped by what you are doing: Watch, Alliance, Events, Boards. On a phone it opens from the menu button.',
  },
  {
    title: 'Go to a screen',
    body: 'Press Ctrl K (⌘ K on a Mac) to jump to any screen or alliance by name.',
  },
  {
    title: 'Tabs inside a screen',
    body: 'A player or alliance page is a header plus one tab at a time. Growth is first; the rest sit beside it.',
  },
  {
    title: 'How fresh is this?',
    body: 'The strip under the top bar says when data last arrived. A figure is only as recent as the last time the collector saw it.',
  },
];

export function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'done';
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(KEY, 'done');
  } catch {
    // The tour comes back next time; nothing worse.
  }
}

/** The step after `index`, or null when `index` was the last. */
export function nextStep(index: number): number | null {
  return index + 1 < TOUR_STEPS.length ? index + 1 : null;
}
