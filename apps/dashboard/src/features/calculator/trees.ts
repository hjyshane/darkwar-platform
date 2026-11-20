// Research for the calculator, split the way the research screen is: one
// group per main tree (the client's `aps_science_tab`, a subject's
// `category`). 633 researches in one dropdown was a search box with a list
// attached; a tree is a few dozen.
//
// WHICH TREES. The ones our servers see. The client keeps two research
// screens — servers 1–564 (Develop, Economy, Battle …) and 565 on (New Home,
// Shelter Building …) — and `fetchResearchTabs` already filters by server and
// orders as the game does. A research in a tree it does not return (the other
// screen's, or a tab id the client has no row for) is left out of the picker;
// a link to one still opens.

import type { ResearchTab, Subject } from '../planner/data';

/** A server of the group, for "which research screen": every server from 565
 * on shares one, so which of ours is named does not matter. */
export const OUR_SERVER = 577;

export interface TreeGroup {
  tabId: number;
  label: string;
  subjects: Subject[];
}

/** The subjects grouped by tree, trees in the order given (the game's) and
 * subjects in theirs. A tree with no research is left out. */
export function groupByTree(
  subjects: ReadonlyArray<Subject>,
  tabs: ReadonlyArray<ResearchTab>,
): TreeGroup[] {
  return tabs
    .map((tab) => ({
      tabId: tab.tabId,
      label: tab.name,
      subjects: subjects.filter((s) => s.category === tab.tabId),
    }))
    .filter((group) => group.subjects.length > 0);
}
