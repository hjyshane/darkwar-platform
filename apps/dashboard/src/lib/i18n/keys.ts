// Which English strings reach t() without being written inside it: labels
// that live in data (the route tables, the tour, the weekday names) and are
// translated where they are drawn. i18n.test.ts adds every literal call of t in
// the source to these and checks that each catalogue covers them all.

import { WEEKDAYS } from '../../features/eventGuide/guide';
import {
  ADMIN_GROUPS,
  ALLIANCE_TABS,
  ALLIANCE_VIEWS,
  CALCULATOR,
  EVENTS_HUB_TABS,
  EVENT_GUIDE_TABS,
  EVENT_TABS,
  HIVE,
  MEMBERS,
  OVERVIEW_TABS,
  RANKING_TABS,
} from '../route';
import { OTHER_LABELS } from '../shellNav';
import { TERMS } from '../terms';
import { TOUR_STEPS } from '../tour';

/** Names, not words: the game's own events and the site's features, kept in
 * English in every language (core.ts). A catalogue may still carry one — the
 * owner may want the Korean client's name — but none has to. */
export const NAMES: ReadonlySet<string> = new Set([
  'Black Gold',
  'Frankie',
  'Capital Clash',
  'Server Clash',
  'Alliance Duel',
  'Survival Preparedness',
  'Hive',
  'Season 2',
  'Season 3',
  'Arena',
]);

export function dynamicKeys(): Set<string> {
  return new Set<string>([
    ...[
      ...ALLIANCE_VIEWS,
      ...ADMIN_GROUPS,
      ...CALCULATOR.tabs,
      ...EVENTS_HUB_TABS,
      ...EVENT_GUIDE_TABS,
      ...HIVE.tabs,
      ...MEMBERS.tabs,
      ...OVERVIEW_TABS,
      ...RANKING_TABS,
      ...EVENT_TABS,
      ...ALLIANCE_TABS,
    ].map((entry) => entry.label),
    ...Object.values(OTHER_LABELS).filter((label): label is string => label !== undefined),
    ...TOUR_STEPS.flatMap((step) => [step.title, step.body]),
    ...WEEKDAYS,
    'Auto',
    'Light',
    'Dark',
    TERMS.signIn,
  ]);
}
