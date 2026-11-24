// Which English strings reach t() without being written inside it: labels
// that live in data (the route tables, the tour, the weekday names) and are
// translated where they are drawn. i18n.test.ts adds every literal call of t in
// the source to these and checks that each catalogue covers them all.

import { GROUPS as EMOJI_GROUPS } from '../../components/EmojiPalette';
import { COLOUR_TITLES, GROUPS as MARKUP_GROUPS } from '../../components/MarkupEditor';
import { TABS as ACCOUNT_TABS } from '../../features/account/AccountPage';
import { OBJECTIVES, OBJECTIVE_FACTS, SCATTERED_NOTE } from '../../features/blackGold/battlefield';
import { PLAN_OBJECTIVES } from '../../features/blackGold/bgbPlan';
import { VERDICT_TEXT } from '../../features/calculator/ResistanceCalculator';
import { CHIP_QUALITIES } from '../../features/calculator/chips';
import { KIND_OPTIONS } from '../../features/calculator/model';
import { WEEKDAYS as MONTH_WEEKDAYS } from '../../features/calendar/MonthView';
import { CATEGORY_LABELS } from '../../features/calendar/data';
import { CAPITAL_CLASH, SERVER_CLASH } from '../../features/eventBoard/EventBoardPage';
import { WEEKDAYS } from '../../features/eventGuide/guide';
import { CATEGORIES as GUIDE_CATEGORIES } from '../../features/guides/GuidesPanel';
import { SIZES, TOOLS } from '../../features/hive/EditorToolbar';
import { MAP_MODES } from '../../features/map/MapModes';
import { QUALITY_NAMES } from '../../features/map/hunt';
import { MAP_LAYERS } from '../../features/map/layers';
import { MARKS } from '../../features/participation/AttendanceRecorder';
import { BOARDS, REST_KINDS } from '../../features/participation/ParticipationPage';
import { SECTIONS as PLANNER_SECTIONS } from '../../features/planner/PlannerPage';
import { GROUPS as STOCK_GROUPS } from '../../features/planner/StockPanel';
import { TABS as SHOP_TABS } from '../../features/shopValue/ShopValuePage';
import { PACK_CATEGORIES, SHOP_LABELS } from '../../features/shopValue/data';
import { ORDER_LABELS } from '../hiveFormation';
import { METRIC_CATALOGUE } from '../overviewMetrics';
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
  return new Set<string>(
    [
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
      // Every term the screens name things by (lib/terms.ts).
      ...Object.values(TERMS),
      // Screen-by-screen tables, drawn with t(entry.label) where they are shown
      // (2026-11-24, phase 2).
      ...ACCOUNT_TABS.map(([, label]) => label),
      ...OBJECTIVES.map((objective) => objective.label),
      ...OBJECTIVE_FACTS.flatMap((fact) => [fact.name, fact.note, fact.sustained]),
      SCATTERED_NOTE,
      ...PLAN_OBJECTIVES.map((objective) => objective.label),
      ...Object.values(CATEGORY_LABELS),
      ...MONTH_WEEKDAYS,
      ...Object.values(VERDICT_TEXT),
      ...Object.values(CHIP_QUALITIES),
      ...KIND_OPTIONS.map((kind) => kind.label),
      ...[CAPITAL_CLASH, SERVER_CLASH].flatMap((board) => [
        board.subtitle,
        board.emptyText,
        board.rule,
      ]),
      ...GUIDE_CATEGORIES.map((category) => category.label),
      ...TOOLS.flatMap((tool) => [tool.label, tool.hint]),
      ...SIZES.map((size) => size.label),
      ...MAP_MODES.flatMap((mode) => [mode.label, mode.hint]),
      ...Object.values(QUALITY_NAMES),
      ...MAP_LAYERS.map((layer) => layer.label),
      ...MARKS.map(([, label]) => label),
      ...BOARDS.map(([, label]) => label),
      ...REST_KINDS.map(([, label]) => label),
      ...PLANNER_SECTIONS.map(([, label]) => label),
      ...STOCK_GROUPS.map(([label]) => label),
      ...SHOP_TABS.map(([, label]) => label),
      ...PACK_CATEGORIES.map((category) => category.label),
      ...Object.values(SHOP_LABELS),
      ...EMOJI_GROUPS.map((group) => group.name),
      ...MARKUP_GROUPS.flat().map((button) => button.title),
      ...Object.values(COLOUR_TITLES),
      ...Object.values(ORDER_LABELS),
      ...METRIC_CATALOGUE.flatMap((metric) => [
        metric.label,
        ...(metric.note ? [metric.note] : []),
      ]),
    ]
      // A dash or a symbol is not a word to translate.
      .filter((key) => /\p{L}/u.test(key)),
  );
}
