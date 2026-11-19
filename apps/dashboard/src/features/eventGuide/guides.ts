// Event guides (0310): the row the admin editor writes, and the pure helpers
// it needs. `starts_rule` is the officer's fallback for a festival the game
// gives no id, read in SERVER TIME (UTC−2), the clock the members read.

import type { ParsedSection } from './sections/index';
import { type ItemRef, itemRefKey } from './sections/itemRef';

export interface GuideRow {
  guide_id: string;
  activity_id: string | null;
  slug: string;
  title: string;
  title_ko: string | null;
  summary: string | null;
  summary_ko: string | null;
  starts_rule: unknown;
  published: boolean;
  post_id: string | null;
  updated_at: string;
}

/** How a guide with no activity id says when it starts. Every field optional:
 * an officer fills what they know. */
export interface StartsRule {
  /** Monday = 1 … Sunday = 7, as the Duel's `day`. */
  weekday?: number;
  /** `HH:MM`, server time. */
  time?: string;
  /** Free text: `577-584`. Shown, not computed with. */
  servers?: string;
  note?: string;
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseStartsRule(value: unknown): StartsRule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const rule: StartsRule = {};
  if (
    typeof raw.weekday === 'number' &&
    Number.isInteger(raw.weekday) &&
    raw.weekday >= 1 &&
    raw.weekday <= 7
  ) {
    rule.weekday = raw.weekday;
  }
  if (typeof raw.time === 'string' && CLOCK.test(raw.time)) rule.time = raw.time;
  if (typeof raw.servers === 'string' && raw.servers.trim() !== '') rule.servers = raw.servers;
  if (typeof raw.note === 'string' && raw.note.trim() !== '') rule.note = raw.note;
  return rule;
}

/** Every distinct item a guide's sections name, so the page asks the
 * catalogue for those ids and no others. */
export function refsIn(sections: readonly ParsedSection[]): ItemRef[] {
  const seen = new Map<string, ItemRef>();
  const add = (ref: ItemRef | null | undefined) => {
    if (ref) seen.set(itemRefKey(ref), ref);
  };
  for (const section of sections) {
    switch (section.kind) {
      case 'rewards':
        for (const item of section.payload.items) add(item.item_ref);
        break;
      case 'stages':
        for (const group of section.payload.groups) {
          for (const stage of group.stages) for (const drop of stage.drops) add(drop.item_ref);
        }
        for (const drop of section.payload.totals) add(drop.item_ref);
        break;
      case 'point_table':
        for (const row of section.payload.rows) add(row.item_ref);
        break;
      case 'prep':
        for (const item of section.payload.items) add(item.item_ref);
        break;
      default:
        break;
    }
  }
  return [...seen.values()];
}

/** A title as an address: what `event_guides.slug` accepts. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug === '' ? 'guide' : slug;
}
